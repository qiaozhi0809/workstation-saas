import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import * as client from '@/shared/api/client'
import { CameraPlayer } from './CameraPlayer'

const h = vi.hoisted(() => {
  type Handler = (event: string, data: unknown) => void
  class FakeHls {
    static supported = true
    static instances: FakeHls[] = []
    static isSupported = () => FakeHls.supported
    static Events = {
      ERROR: 'hlsError',
      MANIFEST_PARSED: 'hlsManifestParsed',
      LEVEL_LOADED: 'hlsLevelLoaded',
      FRAG_LOADED: 'hlsFragLoaded',
    }
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError',
      LEVEL_LOAD_ERROR: 'levelLoadError',
      FRAG_LOAD_ERROR: 'fragLoadError',
      BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError',
      BUFFER_ADD_CODEC_ERROR: 'bufferAddCodecError',
      MANIFEST_INCOMPATIBLE_CODECS_ERROR: 'manifestIncompatibleCodecsError',
    }
    handlers = new Map<string, Handler[]>()
    /** 不带数据的 hlsFragLoaded 自动带递增的 frag.sn(真 hls.js 每个片段都有序列号) */
    nextSn = 1
    config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }
    loadSource = vi.fn()
    attachMedia = vi.fn()
    stopLoad = vi.fn()
    startLoad = vi.fn()
    recoverMediaError = vi.fn()
    destroy = vi.fn()
    constructor(config: FakeHls['config']) {
      this.config = config
      FakeHls.instances.push(this)
    }
    on(event: string, cb: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb])
    }
    off() {}
    emit(event: string, data?: unknown) {
      if (event === 'hlsFragLoaded' && data === undefined) data = { frag: { sn: this.nextSn++ } }
      for (const cb of this.handlers.get(event) ?? []) cb(event, data)
    }
  }
  return { FakeHls }
})
vi.mock('hls.js', () => ({ default: h.FakeHls }))

const { FakeHls } = h
const hls = () => FakeHls.instances[FakeHls.instances.length - 1]
const manifestError = (code: number, body = '') => ({
  type: 'networkError',
  details: 'manifestLoadError',
  fatal: true,
  response: { code, text: body },
  networkDetails: { responseText: body },
})
const errBody = (code: string) => JSON.stringify({ error: { code, message: 'x' } })
/**
 * hls.js 1.7 片段请求失败的样子:4xx 不按 fragLoadPolicy 重试(retryForHttpStatus),单码率层又无处可切,
 * ErrorController.onErrorOut 在我们的监听之前就把 fatal 置真并 stopLoad——所以到这里时已经是 fatal
 */
const segmentError = (code: number, body = '') => ({
  type: 'networkError',
  details: 'fragLoadError',
  fatal: true,
  frag: { sn: 7, url: `/api/v1/cameras/c1/hls/seg7.ts?exp=1&u=u&sig=s` },
  response: { code, text: body },
  networkDetails: { responseText: body },
})
const mediaError = (details = 'bufferAppendError') => ({ type: 'mediaError', details, fatal: true })
const frag = (sn: number) => ({ frag: { sn } })
/** hls.js LEVEL_LOADED 的样子(只保留播放器会读的字段):直播播放列表的目标时长与片段序号窗口 */
const level = (over: Partial<{ targetduration: number; startSN: number; endSN: number }> = {}) => ({
  details: { live: true, targetduration: 2, startSN: 1, endSN: 3, ...over },
})
const video = (title = 't') => screen.getByLabelText(title) as HTMLVideoElement
const starting = () => manifestError(503, errBody('STREAM_STARTING'))

beforeEach(() => {
  FakeHls.instances = []
  FakeHls.supported = true
  useAuthStore.setState({ accessToken: 'tok-1', refreshToken: 'r' })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CameraPlayer', () => {
  it('loads the playlist and shows a loading state first', () => {
    render(<CameraPlayer cameraId="c1" title="一号机位" />)
    expect(hls().loadSource).toHaveBeenCalledWith('/api/v1/cameras/c1/stream.m3u8')
    expect(hls().attachMedia).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    const video = screen.getByLabelText('一号机位') as HTMLVideoElement
    expect(video.muted).toBe(true)
    act(() => hls().emit('hlsFragLoaded'))
    expect(screen.queryByText('加载中')).toBeNull()
  })

  it('sets auth header only for playlist', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    const setRequestHeader = vi.fn()
    const xhr = { setRequestHeader } as unknown as XMLHttpRequest
    const { xhrSetup } = hls().config
    xhrSetup!(xhr, '/api/v1/cameras/c1/stream.m3u8')
    expect(setRequestHeader).toHaveBeenLastCalledWith('Authorization', 'Bearer tok-1')
    useAuthStore.setState({ accessToken: 'tok-2' })
    xhrSetup!(xhr, `${window.location.origin}/api/v1/cameras/c1/stream.m3u8?x=1`)
    expect(setRequestHeader).toHaveBeenLastCalledWith('Authorization', 'Bearer tok-2')
    setRequestHeader.mockClear()
    xhrSetup!(xhr, 'https://host.invalid/api/v1/cameras/c1/stream.m3u8?x=1')
    xhrSetup!(xhr, '/api/v1/cameras/c1/seg/1.ts?sig=abc')
    xhrSetup!(xhr, '/api/v1/cameras/c1/seg/2.m4s?sig=abc')
    expect(setRequestHeader).not.toHaveBeenCalled()
  })

  it('sends no header without a token', () => {
    useAuthStore.setState({ accessToken: null })
    render(<CameraPlayer cameraId="c1" title="t" />)
    const setRequestHeader = vi.fn()
    hls().config.xhrSetup!(
      { setRequestHeader } as unknown as XMLHttpRequest,
      '/api/v1/cameras/c1/stream.m3u8',
    )
    expect(setRequestHeader).not.toHaveBeenCalled()
  })

  it('retries on STREAM_STARTING', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    expect(h0.loadSource).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 4; i++) {
      act(() => h0.emit('hlsError', manifestError(503, errBody('STREAM_STARTING'))))
      expect(screen.queryByText('摄像头连不上')).toBeNull()
      act(() => void vi.advanceTimersByTime(1999))
      expect(h0.loadSource).toHaveBeenCalledTimes(i)
      act(() => void vi.advanceTimersByTime(1))
      expect(h0.loadSource).toHaveBeenCalledTimes(i + 1)
    }
    act(() => h0.emit('hlsError', manifestError(503, errBody('STREAM_STARTING'))))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    act(() => void vi.advanceTimersByTime(10000))
    expect(h0.loadSource).toHaveBeenCalledTimes(5)
    expect(h0.destroy).toHaveBeenCalled()
  })

  it('shows STREAM_BUSY message', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', manifestError(503, errBody('STREAM_BUSY'))))
    expect(screen.getByRole('alert')).toHaveTextContent('同时观看的摄像头太多,请稍后再试')
    act(() => void vi.advanceTimersByTime(10000))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
  })

  it('treats an unparsable 503 body like any fatal error without crashing', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', manifestError(503, '<html>bad gateway')))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('shows codec error for incompatible codecs', () => {
    // H.265 主码流:片段能下载(状态已是 playing),解码器建不起来才报错——要换成编码提示,不是"连不上"
    for (const details of [
      'bufferIncompatibleCodecsError',
      'bufferAddCodecError',
      'manifestIncompatibleCodecsError',
    ]) {
      render(<CameraPlayer cameraId="c1" title="t" />)
      act(() => hls().emit('hlsFragLoaded'))
      act(() => hls().emit('hlsError', { type: 'mediaError', details, fatal: true }))
      expect(screen.getByRole('alert')).toHaveTextContent(
        '这路摄像头的视频编码浏览器不支持(多为 H.265):请让信息中心改用 H.264 子码流或开启转码',
      )
      expect(screen.queryByText('摄像头连不上')).toBeNull()
      expect(hls().destroy).toHaveBeenCalled()
      cleanup()
    }
    // 非致命的编码错误(hls.js 可能先报一次再升级为致命)不结束播放
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() =>
      hls().emit('hlsError', { type: 'mediaError', details: 'bufferAddCodecError', fatal: false }),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hls().destroy).not.toHaveBeenCalled()
    // 其他致命媒体错误:先 recoverMediaError 一次,再来才是"连不上"(编码错误不走恢复,上面已验)
    act(() => hls().emit('hlsError', mediaError('fragParsingError')))
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => hls().emit('hlsError', mediaError('fragParsingError')))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('segment 403 reloads playlist once', () => {
    // 签名过期(隐藏超过 60 秒再回来)/ 换班:重新取播放列表拿新签名,而不是"摄像头连不上"
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
    act(() => hls().emit('hlsFragLoaded'))
    // 非致命的片段 403(hls.js 还在自己处理)不归我们管
    act(() => hls().emit('hlsError', { ...segmentError(403), fatal: false }))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    act(() => hls().emit('hlsError', segmentError(403)))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
    expect(hls().loadSource).toHaveBeenLastCalledWith('/api/v1/cameras/c1/stream.m3u8')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hls().destroy).not.toHaveBeenCalled()
    // 重取之后片段还是 403(中间没有任何片段成功)→ 才算连不上
    act(() => hls().emit('hlsError', segmentError(403)))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('segment 404 after a stream restart takes the same reload path', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', segmentError(404)))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a loaded fragment resets the segment budget; a playlist 403 after the reload still ends', () => {
    const onEnded = vi.fn()
    render(<CameraPlayer cameraId="c1" title="t" onEnded={onEnded} />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', segmentError(403)))
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', segmentError(403)))
    expect(hls().loadSource).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).toBeNull()
    // 播放列表本身 403:课已结束 / 权限没了,照旧 ended
    act(() => hls().emit('hlsError', manifestError(403)))
    expect(screen.getByRole('status')).toHaveTextContent('本节课已结束,看不到了')
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('a non-4xx fatal segment error is still offline', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', segmentError(0)))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('recovers media error once', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', mediaError()))
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hls().destroy).not.toHaveBeenCalled()
    // 恢复后视频没有真的播起来(只是又下到片段)就再次致命 → 连不上,不无限循环
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', mediaError()))
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('allows another media recovery once the video really plays again', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => hls().emit('hlsError', mediaError()))
    act(() => void video().dispatchEvent(new Event('playing')))
    act(() => hls().emit('hlsError', mediaError()))
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a non-fatal media error is left to hls.js', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', { ...mediaError('bufferStalledError'), fatal: false }))
    expect(hls().recoverMediaError).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stall reloads then shows retry', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
    act(() => hls().emit('hlsFragLoaded'))
    const h0 = hls()
    // 20 秒没有新片段也没有 timeupdate:先悄悄重取一次播放列表
    act(() => void vi.advanceTimersByTime(19999))
    expect(h0.loadSource).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(1))
    expect(h0.loadSource).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    // 再 20 秒还是没动静:提示 + 重试按钮,同时继续自动重连
    act(() => void vi.advanceTimersByTime(20000))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    expect(h0.loadSource).toHaveBeenCalledTimes(3)
    expect(h0.destroy).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(20000))
    expect(h0.loadSource).toHaveBeenCalledTimes(4)
    // 重试 = 重建 hls 实例
    act(() => void screen.getByRole('button', { name: '重试' }).click())
    expect(h0.destroy).toHaveBeenCalledTimes(1)
    expect(FakeHls.instances).toHaveLength(2)
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('segments replayed after a stall reload are not progress: the second beat is stalled', () => {
    // L182 主场景:ffmpeg 活着却不出片。真 hls.js 对 loadSource(同 URL) 会重建 MediaSource、把旧播放列表
    // 尾部的片段再下一遍并回放几秒——这些 sn 不比以前大,不能当作恢复,否则"画面已停止"永远到不了
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    act(() => h0.emit('hlsFragLoaded', frag(10)))
    act(() => h0.emit('hlsFragLoaded', frag(11)))
    act(() => void vi.advanceTimersByTime(20000))
    expect(h0.loadSource).toHaveBeenCalledTimes(2)
    // 重取后只回放旧片段 10、11,播放位置也走了 6 秒
    act(() => h0.emit('hlsFragLoaded', frag(10)))
    act(() => h0.emit('hlsFragLoaded', frag(11)))
    for (let i = 0; i < 6; i++) {
      act(() => void vi.advanceTimersByTime(1000))
      act(() => void video().dispatchEvent(new Event('timeupdate')))
    }
    expect(screen.queryByRole('alert')).toBeNull()
    // 回放完又停:timeupdate 只让看门狗从头计,预算没复位 → 第二拍就是提示 + 重试
    act(() => void vi.advanceTimersByTime(19999))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(h0.loadSource).toHaveBeenCalledTimes(3)
    // 提示期间回放旧片段也撤不掉提示;真正的新片段(sn 更大)才算恢复
    act(() => h0.emit('hlsFragLoaded', frag(11)))
    act(() => void video().dispatchEvent(new Event('playing')))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    act(() => h0.emit('hlsFragLoaded', frag(12)))
    expect(screen.queryByRole('alert')).toBeNull()
    // 恢复后再停:又是先悄悄重取一次
    act(() => void vi.advanceTimersByTime(20000))
    expect(h0.loadSource).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offline after a stall reload hits STREAM_STARTING keeps the retry button', () => {
    // 停滞重取撞上后端正在重启 ffmpeg:4 次 STREAM_STARTING 预算用尽 → 连不上,但"重试"不能跟着消失
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(40000))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    for (let i = 0; i < 4; i++) {
      act(() => h0.emit('hlsError', starting()))
      act(() => void vi.advanceTimersByTime(2000))
    }
    act(() => h0.emit('hlsError', starting()))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    expect(h0.destroy).toHaveBeenCalledTimes(1)
    act(() => void screen.getByRole('button', { name: '重试' }).click())
    expect(FakeHls.instances).toHaveLength(2)
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('new fragments and timeupdate keep the stall watchdog quiet', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    for (let i = 0; i < 4; i++) {
      act(() => void vi.advanceTimersByTime(15000))
      act(() => hls().emit('hlsFragLoaded'))
    }
    for (let i = 0; i < 4; i++) {
      act(() => void vi.advanceTimersByTime(15000))
      act(() => void video().dispatchEvent(new Event('timeupdate')))
    }
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(20000))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
  })

  it('progress after a stall clears the message and resets the budget', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(40000))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    act(() => hls().emit('hlsFragLoaded'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(hls().loadSource).toHaveBeenCalledTimes(3)
    // 又停了:还是先悄悄重取一次
    act(() => void vi.advanceTimersByTime(20000))
    expect(hls().loadSource).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the stall watchdog pauses while hidden and resumes when visible', () => {
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(15000))
    hidden = true
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    act(() => void vi.advanceTimersByTime(120000))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(hls().startLoad).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(19999))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(1))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
  })

  it('no stall watchdog before the first picture', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => void vi.advanceTimersByTime(60000))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
  })

  it('an unknown non-fatal 503 falls through to the fatal check', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', { ...manifestError(503, '<html>gw'), fatal: false }))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    expect(hls().destroy).not.toHaveBeenCalled()
  })

  it('resets the STREAM_STARTING budget after a successful manifest', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    for (let i = 0; i < 4; i++) {
      act(() => h0.emit('hlsError', manifestError(503, errBody('STREAM_STARTING'))))
      act(() => void vi.advanceTimersByTime(2000))
    }
    act(() => h0.emit('hlsManifestParsed'))
    act(() => h0.emit('hlsFragLoaded'))
    act(() => h0.emit('hlsError', manifestError(503, errBody('STREAM_STARTING'))))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
  })

  it('blocks picture-in-picture, download, casting and the context menu', () => {
    render(<CameraPlayer cameraId="c1" title="一号机位" />)
    const video = screen.getByLabelText('一号机位') as HTMLVideoElement
    expect(video).toHaveAttribute('disablepictureinpicture')
    expect(video).toHaveAttribute('controlslist', 'nodownload noremoteplayback')
    expect(video).toHaveAttribute('disableremoteplayback')
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    video.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('does not count the 8 s while the playlist request is still pending', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => void vi.advanceTimersByTime(30000))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
  })

  it('creates hls without 503/network retries on playlists', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    const cfg = hls().config as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const key of ['manifestLoadPolicy', 'playlistLoadPolicy']) {
      const p = cfg[key].default
      expect(p.errorRetry.maxNumRetry).toBe(0)
      expect(p.timeoutRetry.maxNumRetry).toBe(0)
      expect(p.maxTimeToFirstByteMs).toBeGreaterThanOrEqual(9000)
    }
  })

  it('hiding the page during the first 8 s does not kill the tile', () => {
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
    act(() => void vi.advanceTimersByTime(5000))
    hidden = true
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    act(() => void vi.advanceTimersByTime(60000))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    act(() => void vi.advanceTimersByTime(7999))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('shows offline 8 s after MANIFEST_PARSED without any fragment', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
    act(() => void vi.advanceTimersByTime(7999))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('calls onPlaying once, at the first picture', () => {
    const onPlaying = vi.fn()
    render(<CameraPlayer cameraId="c1" title="t" onPlaying={onPlaying} />)
    act(() => hls().emit('hlsManifestParsed'))
    expect(onPlaying).not.toHaveBeenCalled()
    act(() => hls().emit('hlsFragLoaded'))
    expect(onPlaying).toHaveBeenCalledTimes(1)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => void screen.getByLabelText('t').dispatchEvent(new Event('playing')))
    expect(onPlaying).toHaveBeenCalledTimes(1)
  })

  it('does not time out once a picture arrived', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
    act(() => hls().emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(20000))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
  })

  it('shows period ended on 403 and calls onEnded', () => {
    const onEnded = vi.fn()
    render(<CameraPlayer cameraId="c1" title="t" onEnded={onEnded} />)
    act(() => hls().emit('hlsError', manifestError(403)))
    act(() => hls().emit('hlsError', manifestError(403)))
    expect(screen.getByRole('status')).toHaveTextContent('本节课已结束,看不到了')
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('shows lan only on CAMERA_LAN_ONLY', () => {
    const onEnded = vi.fn()
    render(<CameraPlayer cameraId="c1" title="t" onEnded={onEnded} />)
    act(() => hls().emit('hlsError', manifestError(403, errBody('CAMERA_LAN_ONLY'))))
    expect(screen.getByRole('alert')).toHaveTextContent('只能在校园网内观看')
    expect(onEnded).not.toHaveBeenCalled()
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('refreshes token once on playlist 401 then retries', async () => {
    const refresh = vi.spyOn(client, 'tryRefreshAccessToken').mockResolvedValue('ok')
    render(<CameraPlayer cameraId="c1" title="t" />)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('refreshes again for a later 401 after a successful load, but not two in a row', async () => {
    const refresh = vi.spyOn(client, 'tryRefreshAccessToken').mockResolvedValue('ok')
    render(<CameraPlayer cameraId="c1" title="t" />)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    act(() => hls().emit('hlsManifestParsed'))
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(refresh).toHaveBeenCalledTimes(1) // manifest alone does not reset the flag
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('refreshes again after a real picture', async () => {
    const refresh = vi.spyOn(client, 'tryRefreshAccessToken').mockResolvedValue('ok')
    render(<CameraPlayer cameraId="c1" title="t" />)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    act(() => hls().emit('hlsFragLoaded'))
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(hls().loadSource).toHaveBeenCalledTimes(3)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('does not load while hidden at mount and loads once visible', () => {
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    expect(hls().loadSource).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(20000))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    expect(hls().startLoad).not.toHaveBeenCalled()
  })

  it('defers a STREAM_STARTING retry while hidden', () => {
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', manifestError(503, errBody('STREAM_STARTING'))))
    hidden = true
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    act(() => void vi.advanceTimersByTime(2000))
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(hls().loadSource).toHaveBeenCalledTimes(2)
  })

  it('logs out when refresh rejected', async () => {
    vi.spyOn(client, 'tryRefreshAccessToken').mockResolvedValue('rejected')
    render(<CameraPlayer cameraId="c1" title="t" />)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(hls().loadSource).toHaveBeenCalledTimes(1)
  })

  it('shows offline when refresh hits a network failure', async () => {
    vi.spyOn(client, 'tryRefreshAccessToken').mockResolvedValue('network')
    render(<CameraPlayer cameraId="c1" title="t" />)
    await act(async () => hls().emit('hlsError', manifestError(401)))
    expect(useAuthStore.getState().accessToken).toBe('tok-1')
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('pauses when hidden', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(hls().stopLoad).toHaveBeenCalledTimes(1)
    hidden = false
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(hls().startLoad).toHaveBeenCalledTimes(1)
  })

  it('destroys on unmount while stalled: no timers, no video listeners left', () => {
    vi.useFakeTimers()
    const { unmount } = render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(40000))
    expect(screen.getByRole('alert')).toHaveTextContent('画面已停止,正在重连…')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const docSpy = vi.spyOn(document, 'removeEventListener')
    const videoSpy = vi.spyOn(video(), 'removeEventListener')
    unmount()
    expect(h0.destroy).toHaveBeenCalledTimes(1)
    expect(docSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(videoSpy).toHaveBeenCalledWith('timeupdate', expect.any(Function))
    expect(videoSpy).toHaveBeenCalledWith('playing', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stall threshold follows target duration', () => {
    // 停滞阈值 = 3 × TARGETDURATION,夹在 8–20 秒(L306):4 秒片段 12 秒才重取,不再固定 20 秒
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    act(() => h0.emit('hlsLevelLoaded', level({ targetduration: 4 })))
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(11999))
    expect(h0.loadSource).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(1))
    expect(h0.loadSource).toHaveBeenCalledTimes(2)
    // 2 秒片段:下限 8 秒
    act(() => h0.emit('hlsLevelLoaded', level({ targetduration: 2 })))
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(7999))
    expect(h0.loadSource).toHaveBeenCalledTimes(2)
    act(() => void vi.advanceTimersByTime(1))
    expect(h0.loadSource).toHaveBeenCalledTimes(3)
    // 10 秒片段:上限 20 秒
    act(() => h0.emit('hlsLevelLoaded', level({ targetduration: 10 })))
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(19999))
    expect(h0.loadSource).toHaveBeenCalledTimes(3)
    act(() => void vi.advanceTimersByTime(1))
    expect(h0.loadSource).toHaveBeenCalledTimes(4)
    // timeupdate 也按新阈值从头计
    act(() => h0.emit('hlsLevelLoaded', level({ targetduration: 3 })))
    act(() => h0.emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(5000))
    act(() => void video().dispatchEvent(new Event('timeupdate')))
    act(() => void vi.advanceTimersByTime(8999))
    expect(h0.loadSource).toHaveBeenCalledTimes(4)
    act(() => void vi.advanceTimersByTime(1))
    expect(h0.loadSource).toHaveBeenCalledTimes(5)
  })

  it('retry button not inside alert', () => {
    // 读屏只朗读告警文字本身;"重试"是告警旁的兄弟节点,不被当作告警内容一起读出(L304)
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsFragLoaded'))
    act(() => void vi.advanceTimersByTime(40000))
    const stalled = screen.getByRole('alert')
    const retry = screen.getByRole('button', { name: '重试' })
    expect(stalled.textContent).toBe('画面已停止,正在重连…')
    expect(stalled).not.toContainElement(retry)
    expect(stalled.parentElement).toBe(retry.parentElement)
    // 连不上(含预算用尽)同样:告警里只有文字
    act(() => hls().emit('hlsError', segmentError(0)))
    const offline = screen.getByRole('alert')
    expect(offline.textContent).toBe('摄像头连不上')
    expect(offline).not.toContainElement(screen.getByRole('button', { name: '重试' }))
  })

  it('shows unsupported hint when Hls is not supported', () => {
    FakeHls.supported = false
    render(<CameraPlayer cameraId="c1" title="t" />)
    expect(screen.getByText('请在电脑或安卓浏览器上观看')).toBeInTheDocument()
    expect(FakeHls.instances).toHaveLength(0)
  })
})
