// 教师端"看看教室":操作台按钮 + 舞台下方的缩略条 + 全屏弹层(整页渲染,hls.js 全部用假实现,不起真流)
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { camerasApi } from '@/shared/api/cameras'
import { classesApi } from '@/shared/api/classes'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassCameras } from '@/shared/types/camera'
import { classFixture, defaultApiMocks, setup, summaryFixture } from './pageTestUtils'

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
    // 与 CameraPlayer.test.tsx 的假实现同一套常量:播放器在这里收到致命的片段 / 媒体错误也不会因
    // 读到 undefined 而抛(L259)
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
    config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }
    src = ''
    loadSource = vi.fn((s: string) => void (this.src = s))
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
      for (const cb of this.handlers.get(event) ?? []) cb(event, data)
    }
  }
  return { FakeHls, idle: [] as { paused: boolean }[] }
})
vi.mock('hls.js', () => ({ default: h.FakeHls }))
// 记下页面每次传给空闲动画的 paused,断言全屏看摄像头时动画停了
vi.mock('./idle/useIdleActions', () => ({
  useIdleActions: (o: { paused: boolean }) => {
    h.idle.push(o)
    return { idle: {}, teacher: 'idle' }
  },
}))
vi.mock('@/shared/api/cameras', () => ({
  camerasApi: {
    classCameras: vi.fn(),
    playlistUrl: (id: string) => `/api/v1/cameras/${id}/stream.m3u8`,
  },
}))
vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')
vi.mock('@/shared/api/exams')

const { FakeHls } = h
/** 还活着(没被销毁)的播放器正在拉的摄像头 id */
const live = () =>
  FakeHls.instances
    .filter((i) => i.destroy.mock.calls.length === 0)
    .map((i) => /cameras\/(.+)\/stream/.exec(i.src)?.[1])

const classCameras = (over: Partial<ClassCameras> = {}): ClassCameras => ({
  class_id: 'c1',
  cameras: [
    { id: 'cam1', name: '讲台机位', location: '教室', status: 'streaming' },
    { id: 'cam2', name: '后排机位', location: '教室', status: 'idle' },
  ],
  reason: 'homeroom',
  period: null,
  ...over,
})

const manifestError = (code: number) => ({
  type: 'networkError',
  details: 'manifestLoadError',
  fatal: true,
  response: { code, text: '' },
  networkDetails: { responseText: '' },
})

/** 打开页面并展开缩略条,等第一路播放器出现;返回 QueryClient 以便触发刷新、router 以便模拟历史导航 */
async function openStrip() {
  const { client, router } = setup()
  fireEvent.click(await screen.findByTestId('camera-toggle'))
  const strip = await screen.findByTestId('camera-strip')
  await within(strip).findByLabelText('讲台机位')
  return { strip, client, router }
}

beforeEach(() => {
  vi.resetAllMocks()
  FakeHls.instances = []
  h.idle.length = 0
  defaultApiMocks()
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ cameras: 2 }))
  vi.mocked(camerasApi.classCameras).mockResolvedValue(classCameras())
})
afterEach(() => {
  vi.useRealTimers()
})

it('hidden when no cameras', async () => {
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ cameras: 0 }))
  setup()
  expect(await screen.findByText('王老师 · 班主任')).toBeInTheDocument()
  expect(screen.queryByTestId('camera-toggle')).toBeNull()
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(camerasApi.classCameras).not.toHaveBeenCalled()
})

it('collapsed by default and expands', async () => {
  setup()
  const toggle = await screen.findByTestId('camera-toggle')
  expect(toggle).toHaveAccessibleName('看看教室')
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(camerasApi.classCameras).not.toHaveBeenCalled()

  fireEvent.click(toggle)
  const strip = await screen.findByTestId('camera-strip')
  expect(camerasApi.classCameras).toHaveBeenCalledWith('c1')
  expect(await within(strip).findByLabelText('讲台机位')).toBeInTheDocument()
  expect(within(strip).getByLabelText('后排机位')).toBeInTheDocument()
  expect(FakeHls.instances).toHaveLength(2)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // 班主任看本班:没有节次说明
  expect(within(strip).queryByTestId('camera-strip-period')).toBeNull()
  // 缩略条在舞台之后、操作台之前
  const stage = screen.getByTestId('classroom-stage')
  const dock = screen.getByRole('toolbar', { name: '教室工具' })
  expect(stage.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(strip.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  // 再点一次收起并销毁播放器
  fireEvent.click(toggle)
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
})

it('shows period reason', async () => {
  vi.mocked(camerasApi.classCameras).mockResolvedValue(
    classCameras({ reason: 'period', period: { no: 3, subject: '数学', ends_at: '10:25' } }),
  )
  await openStrip()
  expect(screen.getByTestId('camera-strip-period')).toHaveTextContent('第 3 节 · 数学 · 到 10:25')
})

it('shows period ended', async () => {
  await openStrip()
  expect(classroomApi.summary).toHaveBeenCalledTimes(1)
  act(() => FakeHls.instances[0].emit('hlsError', manifestError(403)))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(screen.getByText('本节课已结束')).toBeInTheDocument()
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  // 概况重新拉一次:入口随 summary.cameras 变化
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalledTimes(2))
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
})

it('a fatal media error in a thumbnail is recovered in place, not treated as class end', async () => {
  // 缩略播放器收到致命媒体错误:走 recoverMediaError,不收条、不提示下课(L259:假实现要带齐这些常量)
  await openStrip()
  act(() =>
    FakeHls.instances[0].emit('hlsError', {
      type: 'mediaError',
      details: 'bufferAppendError',
      fatal: true,
    }),
  )
  expect(FakeHls.instances[0].recoverMediaError).toHaveBeenCalledTimes(1)
  expect(FakeHls.instances[0].destroy).not.toHaveBeenCalled()
  expect(screen.getByTestId('camera-strip')).toBeInTheDocument()
  expect(screen.queryByText('本节课已结束')).toBeNull()
})

it('collapses on class switch', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [classFixture, { ...classFixture, id: 'c2', name: '三年三班' }],
  })
  await openStrip()
  act(() => useTeacherStore.setState({ classId: 'c2' }))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
  expect(await screen.findByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(camerasApi.classCameras).toHaveBeenCalledTimes(1)
})

it('collapses on mode switch', async () => {
  await openStrip()
  fireEvent.click(screen.getByRole('tab', { name: '考勤' }))
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
})

it('collapses on mode change via history', async () => {
  // 浏览器前进 / 后退改了 ?mode=(没经过模式条的点击):缩略条同样收起、播放器销毁(L218 ①)
  const { router } = await openStrip()
  // 别的参数变化(?foo=)不算切模式,条照旧开着
  await act(() => router.navigate('/teacher/classroom?foo=1'))
  expect(screen.getByTestId('camera-strip')).toBeInTheDocument()
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([0, 0])
  await act(() => router.navigate('/teacher/classroom?foo=1&mode=attendance'))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(FakeHls.instances.map((i) => i.destroy.mock.calls.length)).toEqual([1, 1])
  // 退回日常模式:条不会自己再打开
  await act(() => router.navigate(-1))
  expect(await screen.findByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(FakeHls.instances).toHaveLength(2)
})

it('opens fullscreen with watermark and pauses the idle animation', async () => {
  await openStrip()
  expect(h.idle.at(-1)?.paused).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '全屏查看 讲台机位' }))
  const dialog = await screen.findByRole('dialog', { name: '讲台机位' })
  const full = within(dialog).getByTestId('camera-fullscreen')
  expect(within(full).getByLabelText('讲台机位')).toBeInTheDocument()
  expect(within(full).getByText(/^正在直播 · 示例小学 · .+ · 王老师$/)).toBeInTheDocument()
  // 全屏期间只有全屏这 1 个播放器活着:两个缩略播放器已销毁,缩略位置换成静态占位
  expect(FakeHls.instances).toHaveLength(3)
  expect(live()).toEqual(['cam1'])
  const strip = screen.getByTestId('camera-strip')
  expect(within(strip).queryByLabelText('后排机位')).toBeNull()
  expect(within(strip).getByText('正在全屏')).toBeInTheDocument()
  expect(within(strip).getByText('全屏中暂停')).toBeInTheDocument()
  expect(h.idle.at(-1)?.paused).toBe(true)

  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '讲台机位' })).toBeNull())
  expect(FakeHls.instances[2].destroy).toHaveBeenCalledTimes(1)
  expect(h.idle.at(-1)?.paused).toBe(false)
  // 关闭全屏后缩略播放器重建
  expect(screen.getByTestId('camera-strip')).toBeInTheDocument()
  expect(live()).toEqual(['cam1', 'cam2'])
  expect(FakeHls.instances).toHaveLength(5)
})

it('refresh 403 counts as period ended even without a player error', async () => {
  const { client } = await openStrip()
  vi.mocked(camerasApi.classCameras).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '不能看'))
  await act(() => client.refetchQueries({ queryKey: ['cameras', 'class', 'c1'] }))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(screen.getAllByText('本节课已结束')).toHaveLength(1)
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalledTimes(2))
  expect(live()).toEqual([])
})

it('ends the class when the 30 s refresh comes back with no cameras', async () => {
  // 只假 setInterval:让查询的 30 秒刷新可推进;setTimeout 保持真实,查询结果照常送到组件
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  await openStrip()
  expect(camerasApi.classCameras).toHaveBeenCalledTimes(1)
  vi.mocked(camerasApi.classCameras).mockResolvedValue(classCameras({ cameras: [] }))
  act(() => void vi.advanceTimersByTime(30_000))
  expect(camerasApi.classCameras).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(screen.getAllByText('本节课已结束')).toHaveLength(1)
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalledTimes(2))
  expect(live()).toEqual([])
})

it('reopening after the class ended loads fresh instead of reusing the cached end', async () => {
  const { client } = await openStrip()
  vi.mocked(camerasApi.classCameras).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '不能看'))
  await act(() => client.refetchQueries({ queryKey: ['cameras', 'class', 'c1'] }))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(client.getQueryState(['cameras', 'class', 'c1'])).toBeUndefined()
  // 下一节又能看了:再点开要重新请求,条正常展开,不会被旧 403 立刻收起
  vi.mocked(camerasApi.classCameras).mockResolvedValue(classCameras())
  fireEvent.click(screen.getByTestId('camera-toggle'))
  const strip = await screen.findByTestId('camera-strip')
  expect(await within(strip).findByLabelText('讲台机位')).toBeInTheDocument()
  expect(camerasApi.classCameras).toHaveBeenCalledTimes(3)
  expect(screen.getAllByText('本节课已结束')).toHaveLength(1)
  expect(live()).toEqual(['cam1', 'cam2'])
})

it('keeps the last camera list when a refresh fails for another reason', async () => {
  const { client } = await openStrip()
  vi.mocked(camerasApi.classCameras).mockRejectedValue(new Error('网络断了'))
  await act(() => client.refetchQueries({ queryKey: ['cameras', 'class', 'c1'] }))
  expect(camerasApi.classCameras).toHaveBeenCalledTimes(2)
  // 等查询真的进入 error 状态并渲染出来
  await waitFor(() =>
    expect(client.getQueryState(['cameras', 'class', 'c1'])?.status).toBe('error'),
  )
  await act(async () => {})
  const strip = screen.getByTestId('camera-strip')
  expect(within(strip).queryByRole('alert')).toBeNull()
  expect(within(strip).getByLabelText('讲台机位')).toBeInTheDocument()
  expect(live()).toEqual(['cam1', 'cam2'])
  expect(screen.queryByText('本节课已结束')).toBeNull()
})

it('collapses when the summary says no cameras and does not reopen by itself', async () => {
  const { client } = await openStrip()
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ cameras: 0 }))
  await act(() => client.refetchQueries({ queryKey: ['classroom', 'c1'] }))
  await waitFor(() => expect(screen.queryByTestId('camera-strip')).toBeNull())
  expect(screen.queryByTestId('camera-toggle')).toBeNull()
  expect(live()).toEqual([])
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ cameras: 2 }))
  await act(() => client.refetchQueries({ queryKey: ['classroom', 'c1'] }))
  expect(await screen.findByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByTestId('camera-strip')).toBeNull()
})

it('period ended while fullscreen collapses everything', async () => {
  await openStrip()
  fireEvent.click(screen.getByRole('button', { name: '全屏查看 后排机位' }))
  await screen.findByRole('dialog', { name: '后排机位' })
  act(() => FakeHls.instances[2].emit('hlsError', manifestError(403)))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '后排机位' })).toBeNull())
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(screen.getAllByText('本节课已结束')).toHaveLength(1)
  expect(h.idle.at(-1)?.paused).toBe(false)
})

it('says so inside the strip when the camera list is empty, and 收起 closes it', async () => {
  vi.mocked(camerasApi.classCameras).mockResolvedValue(classCameras({ cameras: [] }))
  setup()
  fireEvent.click(await screen.findByTestId('camera-toggle'))
  const strip = await screen.findByTestId('camera-strip')
  expect(await within(strip).findByText('现在看不到本班的摄像头')).toBeInTheDocument()
  expect(FakeHls.instances).toHaveLength(0)
  fireEvent.click(within(strip).getByRole('button', { name: '收起' }))
  expect(screen.queryByTestId('camera-strip')).toBeNull()
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'false')
})

it('shows the error inside the strip when the camera list fails', async () => {
  vi.mocked(camerasApi.classCameras).mockRejectedValue(new Error('现在不能看这个班的摄像头'))
  setup()
  fireEvent.click(await screen.findByTestId('camera-toggle'))
  const strip = await screen.findByTestId('camera-strip')
  expect(await within(strip).findByRole('alert')).toHaveTextContent('现在不能看这个班的摄像头')
  expect(FakeHls.instances).toHaveLength(0)
})
