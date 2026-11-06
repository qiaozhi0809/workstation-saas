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
      FRAG_LOADED: 'hlsFragLoaded',
    }
    static ErrorDetails = {
      MANIFEST_LOAD_ERROR: 'manifestLoadError',
      LEVEL_LOAD_ERROR: 'levelLoadError',
    }
    handlers = new Map<string, Handler[]>()
    config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }
    loadSource = vi.fn()
    attachMedia = vi.fn()
    stopLoad = vi.fn()
    startLoad = vi.fn()
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

  it('treats an unparsable 503 body as offline without crashing', () => {
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsError', manifestError(503, '<html>bad gateway')))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
  })

  it('shows offline after timeout', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => void vi.advanceTimersByTime(7999))
    expect(screen.queryByText('摄像头连不上')).toBeNull()
    act(() => void vi.advanceTimersByTime(1))
    expect(screen.getByRole('alert')).toHaveTextContent('摄像头连不上')
    expect(hls().destroy).toHaveBeenCalled()
  })

  it('does not time out once a picture arrived', () => {
    vi.useFakeTimers()
    render(<CameraPlayer cameraId="c1" title="t" />)
    act(() => hls().emit('hlsManifestParsed'))
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

  it('destroys on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(<CameraPlayer cameraId="c1" title="t" />)
    const h0 = hls()
    const spy = vi.spyOn(document, 'removeEventListener')
    unmount()
    expect(h0.destroy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows unsupported hint when Hls is not supported', () => {
    FakeHls.supported = false
    render(<CameraPlayer cameraId="c1" title="t" />)
    expect(screen.getByText('请在电脑或安卓浏览器上观看')).toBeInTheDocument()
    expect(FakeHls.instances).toHaveLength(0)
  })
})
