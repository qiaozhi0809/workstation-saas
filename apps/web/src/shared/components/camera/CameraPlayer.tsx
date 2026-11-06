import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { camerasApi } from '@/shared/api/cameras'
import { tryRefreshAccessToken } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'

type PlayState = 'loading' | 'playing' | 'ended' | 'lan' | 'busy' | 'offline' | 'unsupported'

const NO_PICTURE_MS = 8000
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
  ended: { role: 'status', text: '本节课已结束,看不到了' },
  lan: { role: 'alert', text: '只能在校园网内观看' },
  busy: { role: 'alert', text: '同时观看的摄像头太多,请稍后再试' },
  offline: { role: 'alert', text: '摄像头连不上' },
  unsupported: { role: 'alert', text: '请在电脑或安卓浏览器上观看' },
}

export function CameraPlayer({
  cameraId,
  title,
  onEnded,
}: {
  cameraId: string
  title: string
  onEnded?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const [state, setState] = useState<PlayState>(() =>
    Hls.isSupported() ? 'loading' : 'unsupported',
  )

  useEffect(() => {
    if (!Hls.isSupported()) {
      setState('unsupported')
      return
    }
    setState('loading')
    const video = videoRef.current
    const src = camerasApi.playlistUrl(cameraId)
    let alive = true
    let terminal = false
    let gotPicture = false
    let refreshed = false
    let startingRetries = 0
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

    const clearTimers = () => {
      clearTimeout(noPictureTimer)
      clearTimeout(retryTimer)
      noPictureTimer = retryTimer = undefined
    }
    const finish = (next: PlayState) => {
      if (terminal) return
      terminal = true
      clearTimers()
      hls?.destroy()
      hls = null
      if (alive) setState(next)
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
    const markPlaying = () => {
      if (terminal) return
      refreshed = false // 真的出过画面:之后再 401 允许再刷新一次
      startingRetries = 0
      gotPicture = true
      clearTimeout(noPictureTimer)
      setState('playing')
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

    const handleError = (data: HlsErrorData) => {
      if (terminal) return
      const playlistFailed =
        data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR
      const status = data.response?.code
      if (playlistFailed && status === 403)
        return finish(errorCodeOf(data) === 'CAMERA_LAN_ONLY' ? 'lan' : 'ended')
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
      if (data.fatal) finish('offline')
    }

    hls.on(Hls.Events.MANIFEST_PARSED, markFirstSign)
    hls.on(Hls.Events.FRAG_LOADED, markPlaying)
    hls.on(Hls.Events.ERROR, (_e, data) => handleError(data as unknown as HlsErrorData))
    if (video) {
      video.addEventListener('playing', markPlaying)
      hls.attachMedia(video)
    }
    reload()

    const onVisibility = () => {
      if (terminal || !hls) return
      if (document.hidden) {
        clearTimeout(noPictureTimer)
        hls.stopLoad()
      } else if (pendingLoad) {
        pendingLoad = false
        reload()
      } else {
        hls.startLoad()
        if (manifestReady && !gotPicture) armNoPictureTimer()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      terminal = true
      clearTimers()
      document.removeEventListener('visibilitychange', onVisibility)
      video?.removeEventListener('playing', markPlaying)
      hls?.destroy()
      hls = null
    }
  }, [cameraId])

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
        <div
          role={msg.role}
          className="absolute inset-0 flex items-center justify-center bg-background/80 px-3 text-center text-sm text-foreground"
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
