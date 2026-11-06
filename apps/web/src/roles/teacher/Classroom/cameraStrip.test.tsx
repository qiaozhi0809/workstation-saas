// 教师端"看看教室":操作台按钮 + 舞台下方的缩略条 + 全屏弹层(整页渲染,hls.js 全部用假实现,不起真流)
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { camerasApi } from '@/shared/api/cameras'
import { classesApi } from '@/shared/api/classes'
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

/** 打开页面并展开缩略条,等第一路播放器出现 */
async function openStrip() {
  setup()
  fireEvent.click(await screen.findByTestId('camera-toggle'))
  const strip = await screen.findByTestId('camera-strip')
  await within(strip).findByLabelText('讲台机位')
  return strip
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

it('opens fullscreen with watermark and pauses the idle animation', async () => {
  await openStrip()
  expect(h.idle.at(-1)?.paused).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '全屏查看 讲台机位' }))
  const dialog = await screen.findByRole('dialog', { name: '讲台机位' })
  const full = within(dialog).getByTestId('camera-fullscreen')
  expect(within(full).getByLabelText('讲台机位')).toBeInTheDocument()
  expect(within(full).getByText(/^正在直播 · 示例小学 · .+ · 王老师$/)).toBeInTheDocument()
  expect(FakeHls.instances).toHaveLength(3)
  expect(h.idle.at(-1)?.paused).toBe(true)

  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '讲台机位' })).toBeNull())
  expect(FakeHls.instances[2].destroy).toHaveBeenCalledTimes(1)
  expect(h.idle.at(-1)?.paused).toBe(false)
  // 缩略条还在
  expect(screen.getByTestId('camera-strip')).toBeInTheDocument()
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
