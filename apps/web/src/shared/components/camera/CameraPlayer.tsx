import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { camerasApi } from '@/shared/api/cameras'
import { tryRefreshAccessToken } from '@/shared/api/client'
import { Button } from '@/shared/components/ui/button'
import { useAuthStore } from '@/shared/stores/auth'

type PlayState =
  'loading' | 'playing' | 'stalled' | 'ended' | 'lan' | 'busy' | 'offline' | 'unsupported' | 'codec'

const NO_PICTURE_MS = 8000
/**
 * 出画面之后:这么久没有新片段、也没有 timeupdate,就当画面停了。
 * 拿到播放列表(LEVEL_LOADED)后按 3 × TARGETDURATION 算,夹在 8–20 秒之间(片段 2 秒 → 8 秒,
 * 片段 ≥ 7 秒 → 20 秒);拿到之前沿用 20 秒(L306)
 */
const STALL_MS_DEFAULT = 20_000
const STALL_MS_MIN = 8_000
const STALL_MS_MAX = 20_000
const stallMsFor = (targetduration: unknown): number =>
  typeof targetduration === 'number' && targetduration > 0
    ? Math.min(STALL_MS_MAX, Math.max(STALL_MS_MIN, 3 * targetduration * 1000))
    : STALL_MS_DEFAULT
const STARTING_RETRY_MS = 2000
const STARTING_MAX_RETRIES = 4

/** 播放列表请求不让 hls.js 自己重试(重试由本组件负责);服务端会把请求挂住最多约 8 秒再回 503 */
const PLAYLIST_POLICY = {
  default: {
    maxTimeToFirstByteMs: 10000,
    maxLoadTimeMs: 10000,
    timeoutRetry: { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 },
  },
}

interface HlsErrorData {
  type?: string
  details?: string
  fatal?: boolean
  response?: { code?: number; text?: string }
  networkDetails?: { responseText?: string } | null
}

function errorCodeOf(data: HlsErrorData): string | null {
  const raw = data.networkDetails?.responseText ?? data.response?.text
  if (typeof raw !== 'string' || !raw) return null
  try {
    const code = (JSON.parse(raw) as { error?: { code?: unknown } })?.error?.code
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

/** 只给同源的 .m3u8 播放列表带令牌;分片自带签名,跨源地址一律不带 */
function isPlaylistUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin && u.pathname.endsWith('.m3u8')
  } catch {
    return false
  }
}

const MESSAGES: Partial<Record<PlayState, { role: 'status' | 'alert'; text: string }>> = {
  loading: { role: 'status', text: '加载中' },
  stalled: { role: 'alert', text: '画面已停止,正在重连…' },
  ended: { role: 'status', text: '本节课已结束,看不到了' },
  lan: { role: 'alert', text: '只能在校园网内观看' },
  busy: { role: 'alert', text: '同时观看的摄像头太多,请稍后再试' },
  offline: { role: 'alert', text: '摄像头连不上' },
  unsupported: { role: 'alert', text: '请在电脑或安卓浏览器上观看' },
  // 片段下载得到、解码器却建不起来:多半是 H.265 主码流,和"连不上"分开说,信息中心才知道该改什么
  codec: {
    role: 'alert',
    text: '这路摄像头的视频编码浏览器不支持(多为 H.265):请让信息中心改用 H.264 子码流或开启转码',
  },
}

export function CameraPlayer({
  cameraId,
  title,
  onEnded,
  onPlaying,
}: {
  cameraId: string
  title: string
  onEnded?: () => void
  /** 首次出画面时回调一次(轮播用它决定何时销毁旧播放器) */
  onPlaying?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const onPlayingRef = useRef(onPlaying)
  onPlayingRef.current = onPlaying
  const [state, setState] = useState<PlayState>(() =>
    Hls.isSupported() ? 'loading' : 'unsupported',
  )
  // "重试"按钮 +1:effect 重跑,hls 实例重建
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!Hls.isSupported()) {
      setState('unsupported')
      return
    }
    let alive = true
    // 自己记住已显示的状态:每个新片段 / 每次 timeupdate 都不再调 setState 靠 React 同值跳过(L306)
    let shown: PlayState | null = null
    const show = (next: PlayState) => {
      if (!alive || shown === next) return
      shown = next
      setState(next)
    }
    show('loading')
    const video = videoRef.current
    const src = camerasApi.playlistUrl(cameraId)
    let terminal = false
    let gotPicture = false
    let refreshed = false
    let startingRetries = 0
    // 三个"只来一次"的恢复预算:片段 4xx 重取播放列表、致命媒体错误 recoverMediaError、停滞重取
    let segmentReloaded = false
    let mediaRecovered = false
    let stallReloaded = false
    // 已见的最大片段序列号:只有比它大的片段才算"新进展"。自己 loadSource(同一 URL)之后 hls.js 会重建
    // MediaSource、把旧播放列表尾部的片段再下一遍并回放几秒——那些 sn 不比以前大,不能复位停滞预算,
    // 否则 ffmpeg 活着却不出片时就成了每 ~26 秒静默重取 + 回放旧画面,"画面已停止"永远到不了。
    // 后端重启 ffmpeg 时 start_number 取 epoch 秒(stream/supervisor.py),新一轮的序列号照样更大
    let maxSn = -1
    let hls: Hls | null = new Hls({
      manifestLoadPolicy: PLAYLIST_POLICY,
      playlistLoadPolicy: PLAYLIST_POLICY,
      xhrSetup: (xhr, url) => {
        const token = useAuthStore.getState().accessToken
        if (token && isPlaylistUrl(url)) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      },
    })
    let noPictureTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let stallTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      clearTimeout(noPictureTimer)
      clearTimeout(retryTimer)
      clearTimeout(stallTimer)
      noPictureTimer = retryTimer = stallTimer = undefined
    }
    const finish = (next: PlayState) => {
      if (terminal) return
      terminal = true
      clearTimers()
      hls?.destroy()
      hls = null
      show(next)
      if (next === 'ended') onEndedRef.current?.()
    }
    // 8 秒"无画面"计时只在播放列表已拿到之后才算;页面隐藏时暂停,可见后重新计
    let manifestReady = false
    const armNoPictureTimer = () => {
      clearTimeout(noPictureTimer)
      noPictureTimer = setTimeout(() => {
        if (!gotPicture) finish('offline')
      }, NO_PICTURE_MS)
    }
    const markFirstSign = () => {
      if (terminal) return
      startingRetries = 0
      manifestReady = true
      if (!gotPicture && !document.hidden) armNoPictureTimer()
    }
    let pendingLoad = false // 页面隐藏时挂起的加载,等可见再发
    const reload = () => {
      if (terminal || !hls) return
      if (document.hidden) {
        pendingLoad = true
        return
      }
      manifestReady = false
      clearTimeout(noPictureTimer)
      hls.loadSource(src)
    }
    // 停滞看门狗(L182):出画面后 stallMs 没有新片段也没有 timeupdate → 先悄悄重取一次播放列表;
    // 还不动就提示"画面已停止,正在重连…"并给"重试"(重建实例),期间每 stallMs 继续自动重取
    let stallMs = STALL_MS_DEFAULT
    const armStallTimer = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(onStall, stallMs)
    }
    const onStall = () => {
      if (terminal) return
      if (stallReloaded) show('stalled')
      stallReloaded = true
      reload()
      armStallTimer()
    }
    // 播放列表到了:停滞阈值跟着它的 TARGETDURATION 走(下一次计时起生效)
    const onLevelLoaded = (data: { details?: { targetduration?: unknown } } | undefined) => {
      if (terminal) return
      stallMs = stallMsFor(data?.details?.targetduration)
    }
    // 出画面(片段到了 / 视频 playing):8 秒计时取消,401 再刷新与 STREAM_STARTING 的预算恢复,看门狗从头计
    const markPlaying = () => {
      if (terminal) return
      refreshed = false // 真的出过画面:之后再 401 允许再刷新一次
      startingRetries = 0
      const first = !gotPicture
      gotPicture = true
      clearTimeout(noPictureTimer)
      if (!document.hidden) armStallTimer()
      if (first) onPlayingRef.current?.()
    }
    // 片段下载到了:只有序列号比已见最大值大的才是新进展——"重取一次"的预算恢复、停滞提示撤下
    const onFragLoaded = (data: { frag?: { sn?: number | string } } | undefined) => {
      if (terminal) return
      const sn = data?.frag?.sn
      if (sn === 'initSegment') return // fMP4 的初始化段不是画面
      if (typeof sn === 'number') {
        if (sn <= maxSn) return // 重取 / recoverMediaError 之后回放的旧片段
        maxSn = sn
      }
      segmentReloaded = false
      stallReloaded = false
      show('playing')
      markPlaying()
    }
    // 播放位置在走(也可能只是在回放重取回来的旧片段):只让看门狗从头计,预算与提示都不动
    const onTimeUpdate = () => {
      if (terminal || !gotPicture || document.hidden) return
      armStallTimer()
    }
    // 视频真的播起来了(不只是下到片段):媒体错误允许再恢复一次
    const onVideoPlaying = () => {
      mediaRecovered = false
      markPlaying()
    }

    const handleError = (data: HlsErrorData) => {
      if (terminal) return
      const playlistFailed =
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
      const status = data.response?.code
      if (playlistFailed && status === 403)
        return finish(errorCodeOf(data) === 'CAMERA_LAN_ONLY' ? 'lan' : 'ended')
      // 片段 403(签名过期:隐藏超过 60 秒再回来 / 换班)或 404(转流重启后旧片段已删):hls.js 对 4xx 不重试,
      // 单码率层无处可切,到这里已是 fatal 且已 stopLoad——重新取一次播放列表拿新地址;再失败才算连不上。
      // 播放列表本身 403 走上面的 ended / lan
      if (
        data.fatal &&
        data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR &&
        (status === 403 || status === 404)
      ) {
        if (segmentReloaded) return finish('offline')
        segmentReloaded = true
        return reload()
      }
      if (playlistFailed && status === 401) {
        if (refreshed) return finish('offline')
        refreshed = true
        void tryRefreshAccessToken().then((r) => {
          if (terminal || !alive) return
          if (r === 'ok') reload()
          else if (r === 'rejected') {
            finish('offline')
            useAuthStore.getState().logout()
          } else finish('offline')
        })
        return
      }
      if (playlistFailed && status === 503) {
        const code = errorCodeOf(data)
        if (code === 'STREAM_BUSY') return finish('busy')
        if (code === 'STREAM_STARTING' && startingRetries < STARTING_MAX_RETRIES) {
          startingRetries += 1
          clearTimeout(retryTimer)
          retryTimer = setTimeout(reload, STARTING_RETRY_MS)
          return
        }
        if (code === 'STREAM_STARTING') return finish('offline')
      }
      if (!data.fatal) return // 非致命的交给 hls.js 自己处理(重试 / 挪位 / 切层)
      // hls.js 只有一个码率层可切时会把 BUFFER_ADD_CODEC_ERROR 升级为致命
      const codecUnsupported =
        data.details === Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR ||
        data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
        data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR
      if (codecUnsupported) return finish('codec')
      // 致命媒体错误(解码器卡住、追加失败、停滞 nudge 用尽):按 hls.js 的建议先 recoverMediaError
      // (卸下再挂回 MediaSource)一次;视频没有重新播起来就又致命 → 连不上,不无限循环
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
        mediaRecovered = true
        return hls?.recoverMediaError()
      }
      finish('offline')
    }

    hls.on(Hls.Events.MANIFEST_PARSED, markFirstSign)
    hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => onLevelLoaded(data))
    hls.on(Hls.Events.FRAG_LOADED, (_e, data) => onFragLoaded(data))
    hls.on(Hls.Events.ERROR, (_e, data) => handleError(data as unknown as HlsErrorData))
    if (video) {
      video.addEventListener('playing', onVideoPlaying)
      video.addEventListener('timeupdate', onTimeUpdate)
      hls.attachMedia(video)
    }
    reload()

    const onVisibility = () => {
      if (terminal || !hls) return
      if (document.hidden) {
        clearTimeout(noPictureTimer)
        clearTimeout(stallTimer)
        hls.stopLoad()
        return
      }
      if (pendingLoad) {
        pendingLoad = false
        reload()
      } else {
        hls.startLoad()
        if (manifestReady && !gotPicture) armNoPictureTimer()
      }
      if (gotPicture) armStallTimer()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      terminal = true
      clearTimers()
      document.removeEventListener('visibilitychange', onVisibility)
      video?.removeEventListener('playing', onVideoPlaying)
      video?.removeEventListener('timeupdate', onTimeUpdate)
      hls?.destroy()
      hls = null
    }
  }, [cameraId, epoch])

  const msg = MESSAGES[state]
  return (
    <div className="relative h-full w-full overflow-hidden bg-muted">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        aria-label={title}
        className="h-full w-full object-contain"
      />
      {msg && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 px-3 text-center text-sm text-foreground">
          {/* 告警 / 状态容器里只有文字:读屏不会把"重试"按钮也当作告警内容读出(L304) */}
          <div role={msg.role}>{msg.text}</div>
          {/* 停滞提示与"连不上"(含停滞重取撞上转流重启、预算用尽)都给重试:重建 hls 实例 */}
          {(state === 'stalled' || state === 'offline') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEpoch((n) => n + 1)}
            >
              重试
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
