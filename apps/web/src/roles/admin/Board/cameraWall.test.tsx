// 全校看板旁的监控侧栏(整页渲染 BoardPage;hls.js 全部用假实现,不起真流)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import type { CameraBrief, CameraStatus, CameraWall } from '@/shared/types/camera'
import BoardPage from './BoardPage'
import { boardView } from './boardFixtures'

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
    src = ''
    loadSource = vi.fn((s: string) => void (this.src = s))
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
vi.mock('@/shared/api/admin', () => ({ adminApi: { board: vi.fn() } }))
vi.mock('@/shared/api/cameras', () => ({
  camerasApi: {
    wall: vi.fn(),
    playlistUrl: (id: string) => `/api/v1/cameras/${id}/stream.m3u8`,
  },
}))

const { FakeHls } = h
/** 还在播(没被销毁)的播放器正在拉的摄像头 id */
const live = () =>
  FakeHls.instances
    .filter((i) => i.destroy.mock.calls.length === 0)
    .map((i) => /cameras\/(.+)\/stream/.exec(i.src)?.[1])

const cam = (id: string, name: string, status: CameraStatus = 'streaming'): CameraBrief => ({
  id,
  name,
  location: '教室',
  status,
})
const wallFixture = (over: Partial<CameraWall> = {}): CameraWall => ({
  school_name: '示例小学',
  timezone: 'Asia/Shanghai',
  grades: [
    {
      grade_id: 'g3',
      grade_name: '三年级',
      classes: [
        {
          class_id: 'c1',
          class_name: '三年一班',
          cameras: [cam('a1', '讲台机位'), cam('a2', '后排机位', 'idle')],
        },
        { class_id: 'c2', class_name: '三年二班', cameras: [cam('b1', '讲台机位', 'error')] },
        { class_id: 'c3', class_name: '三年三班', cameras: [] },
      ],
    },
    {
      grade_id: 'g4',
      grade_name: '四年级',
      classes: [{ class_id: 'c9', class_name: '四年一班', cameras: [cam('d1', '讲台机位')] }],
    },
  ],
  public: [cam('p1', '操场东')],
  ...over,
})

function setPerms(admin_perms: AdminPerm[]) {
  useAuthStore.setState({
    user: {
      id: 'u1',
      display_name: '李校长',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })
}

function setup(entry = '/admin/board') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/board" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** 打开页面,等侧栏与看板都出来 */
async function openWall(entry?: string) {
  setup(entry)
  const wall = await screen.findByTestId('camera-wall')
  await screen.findByText('三年一班', { selector: '[data-class-card] *' })
  return wall
}

beforeEach(() => {
  vi.resetAllMocks()
  FakeHls.instances = []
  setPerms(['school.view', 'camera.view'])
  vi.mocked(adminApi.board).mockResolvedValue(boardView())
  vi.mocked(camerasApi.wall).mockResolvedValue(wallFixture())
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('CameraWallMini', () => {
  it('lists classes by grade', async () => {
    const wall = await openWall()
    expect(camerasApi.wall).toHaveBeenCalledTimes(1)
    expect(within(wall).getByRole('heading', { name: '三年级' })).toBeInTheDocument()
    expect(within(wall).getByRole('heading', { name: '四年级' })).toBeInTheDocument()
    const c1 = within(wall).getByTestId('camera-wall-class-c1')
    expect(c1).toHaveTextContent('三年一班')
    expect(c1).toHaveTextContent('2 路')
    expect(c1).toHaveTextContent('1 路在播')
    const c2 = within(wall).getByTestId('camera-wall-class-c2')
    expect(c2).toHaveTextContent('1 路故障')
    expect(within(wall).getByTestId('camera-wall-class-c3')).toBeDisabled()
    const pub = within(wall).getByTestId('camera-wall-class-public')
    expect(pub).toHaveTextContent('公共区域')
    expect(pub).toHaveTextContent('1 路')
    // 列出来不等于在播:点开才建播放器
    expect(FakeHls.instances).toHaveLength(0)
    // 年级的顺序:三年级的班在四年级的班之前,公共区域最后
    const c9 = within(wall).getByTestId('camera-wall-class-c9')
    expect(c1.compareDocumentPosition(c9) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(c9.compareDocumentPosition(pub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 侧栏在看板之后(窄屏时落在页面下方);有侧栏时看板少一列
    const grid = document.querySelector('[data-class-grid]')!
    expect(grid.compareDocumentPosition(wall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(grid).toHaveClass('md:grid-cols-2', 'xl:grid-cols-3', '2xl:grid-cols-4')
    expect(grid).not.toHaveClass('lg:grid-cols-3')
  })

  it('grade head sees own grade only', async () => {
    vi.mocked(camerasApi.wall).mockResolvedValue(
      wallFixture({ grades: [wallFixture().grades[0]], public: [] }),
    )
    const wall = await openWall()
    expect(within(wall).getByRole('heading', { name: '三年级' })).toBeInTheDocument()
    expect(within(wall).queryByRole('heading', { name: '四年级' })).toBeNull()
    expect(within(wall).queryByTestId('camera-wall-class-c9')).toBeNull()
    expect(within(wall).queryByTestId('camera-wall-class-public')).toBeNull()
    expect(within(wall).queryByText('公共区域')).toBeNull()
  })

  it('plays a class on click with a watermark and switches cameras inside the class', async () => {
    const wall = await openWall()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c1'))
    expect(within(wall).getByTestId('camera-wall-class-c1')).toHaveAttribute('aria-pressed', 'true')
    expect(within(wall).getByLabelText('讲台机位')).toBeInTheDocument()
    expect(live()).toEqual(['a1'])
    expect(within(wall).getByText(/^正在直播 · 示例小学 · .+ · 李校长$/)).toBeInTheDocument()
    // 多个摄像头:下方切换;新的先建、旧的等新的出画面再销毁
    fireEvent.click(within(wall).getByRole('button', { name: '后排机位' }))
    expect(live()).toEqual(['a1', 'a2'])
    act(() => FakeHls.instances[1].emit('hlsFragLoaded'))
    expect(live()).toEqual(['a2'])
    // 换班也是同样的交接
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c9'))
    expect(live()).toEqual(['a2', 'd1'])
    act(() => FakeHls.instances[2].emit('hlsFragLoaded'))
    expect(live()).toEqual(['d1'])
    expect(within(wall).getByTestId('camera-wall-class-c1')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('drops the old player after 8 s even if the new one never shows a picture', async () => {
    const wall = await openWall()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c1'))
    vi.useFakeTimers()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c9'))
    expect(live()).toEqual(['a1', 'd1'])
    act(() => void vi.advanceTimersByTime(7999))
    expect(live()).toEqual(['a1', 'd1'])
    act(() => void vi.advanceTimersByTime(1))
    expect(live()).toEqual(['d1'])
  })

  it('switching back before the new player shows a picture keeps only the old one', async () => {
    const wall = await openWall()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c1'))
    act(() => FakeHls.instances[0].emit('hlsFragLoaded'))
    vi.useFakeTimers()
    fireEvent.click(within(wall).getByRole('button', { name: '后排机位' }))
    expect(live()).toEqual(['a1', 'a2'])
    // a1 出过画面,切回去不用等 a2 交接:a2 立即销毁,a1 不重建
    fireEvent.click(within(wall).getByRole('button', { name: '讲台机位' }))
    expect(live()).toEqual(['a1'])
    expect(FakeHls.instances).toHaveLength(2)
    act(() => void vi.advanceTimersByTime(20000))
    expect(live()).toEqual(['a1'])
  })

  it('a manual pick restarts the rotation timer', async () => {
    const wall = await openWall()
    vi.useFakeTimers()
    fireEvent.click(within(wall).getByTestId('camera-wall-rotate'))
    expect(live()).toEqual(['a1'])
    act(() => void vi.advanceTimersByTime(9000))
    // 9 秒时手动点公共区域:计时从头算,1 秒后不应切走
    fireEvent.click(within(wall).getByTestId('camera-wall-class-public'))
    act(() => FakeHls.instances.at(-1)!.emit('hlsFragLoaded'))
    expect(live()).toEqual(['p1'])
    act(() => void vi.advanceTimersByTime(9999))
    expect(live()).toEqual(['p1'])
    act(() => void vi.advanceTimersByTime(1))
    expect(live()).toEqual(['p1', 'a1'])
  })

  it('auto rotate every 10s skips error cameras', async () => {
    const wall = await openWall()
    vi.useFakeTimers()
    const rotate = within(wall).getByTestId('camera-wall-rotate')
    expect(rotate).toHaveAttribute('role', 'switch')
    expect(rotate).not.toBeChecked()
    fireEvent.click(rotate)
    expect(rotate).toBeChecked()
    // 没选班时从第一个能看的班开始
    expect(live()).toEqual(['a1'])
    expect(within(wall).getByTestId('camera-wall-class-c1')).toHaveAttribute('aria-pressed', 'true')
    act(() => void vi.advanceTimersByTime(9999))
    expect(live()).toEqual(['a1'])
    // 三年二班只有故障摄像头、三年三班没有摄像头:都跳过,落到四年一班
    act(() => void vi.advanceTimersByTime(1))
    expect(live()).toEqual(['a1', 'd1'])
    act(() => FakeHls.instances.at(-1)!.emit('hlsFragLoaded'))
    expect(live()).toEqual(['d1'])
    expect(within(wall).getByTestId('camera-wall-class-c9')).toHaveAttribute('aria-pressed', 'true')
    // 公共区域也在轮播里,然后回到开头
    act(() => void vi.advanceTimersByTime(10000))
    act(() => FakeHls.instances.at(-1)!.emit('hlsFragLoaded'))
    expect(live()).toEqual(['p1'])
    act(() => void vi.advanceTimersByTime(10000))
    act(() => FakeHls.instances.at(-1)!.emit('hlsFragLoaded'))
    expect(live()).toEqual(['a1'])
    // 关掉开关就停
    fireEvent.click(rotate)
    act(() => void vi.advanceTimersByTime(30000))
    expect(live()).toEqual(['a1'])
  })

  it('does not rotate while the tab is hidden', async () => {
    const wall = await openWall()
    vi.useFakeTimers()
    fireEvent.click(within(wall).getByTestId('camera-wall-rotate'))
    expect(live()).toEqual(['a1'])
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => void vi.advanceTimersByTime(30000))
    expect(live()).toEqual(['a1'])
  })

  it('reads ?rotate=<seconds> only in DEV', async () => {
    const wall = await openWall('/admin/board?rotate=2')
    vi.useFakeTimers()
    fireEvent.click(within(wall).getByTestId('camera-wall-rotate'))
    expect(live()).toEqual(['a1'])
    act(() => void vi.advanceTimersByTime(2000))
    expect(live()).toEqual(['a1', 'd1'])
    cleanup()

    vi.stubEnv('DEV', false)
    FakeHls.instances = []
    vi.useRealTimers()
    const prod = await openWall('/admin/board?rotate=2')
    vi.useFakeTimers()
    fireEvent.click(within(prod).getByTestId('camera-wall-rotate'))
    act(() => void vi.advanceTimersByTime(9999))
    expect(live()).toEqual(['a1'])
    act(() => void vi.advanceTimersByTime(1))
    expect(live()).toEqual(['a1', 'd1'])
  })

  it('nine grid limits to 9', async () => {
    const many = Array.from({ length: 10 }, (_, i) => cam(`m${i}`, `机位${i}`))
    vi.mocked(camerasApi.wall).mockResolvedValue(
      wallFixture({
        grades: [
          {
            grade_id: 'g3',
            grade_name: '三年级',
            classes: [
              { class_id: 'c1', class_name: '三年一班', cameras: many.slice(0, 6) },
              { class_id: 'c2', class_name: '三年二班', cameras: many.slice(6) },
            ],
          },
          wallFixture().grades[1],
        ],
      }),
    )
    const wall = await openWall()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c2'))
    expect(live()).toEqual(['m6'])
    fireEvent.click(within(wall).getByRole('button', { name: '九宫格' }))
    const dialog = await screen.findByRole('dialog', { name: '九宫格' })
    const grid = within(dialog).getByTestId('camera-wall-grid')
    // 默认当前年级(三年级)的前 9 路;侧栏的单画面同时停掉,免得占第 10 路
    expect(within(grid).getAllByLabelText(/机位\d$/)).toHaveLength(9)
    expect(live()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])
    expect(within(dialog).getByText('已选 9 / 9 路')).toBeInTheDocument()
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes).toHaveLength(12) // 三年级 10 + 四年级 1 + 公共区域 1
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(9)
    const tenth = within(dialog).getByRole('checkbox', { name: '三年二班 机位9' })
    const fourth = within(dialog).getByRole('checkbox', { name: '四年一班 讲台机位' })
    const pub = within(dialog).getByRole('checkbox', { name: '公共区域 操场东' })
    expect(tenth).toBeDisabled()
    expect(fourth).toBeDisabled()
    expect(pub).toBeDisabled()
    // 换一路:先取消一路再勾
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '三年一班 机位0' }))
    expect(within(dialog).getByText('已选 8 / 9 路')).toBeInTheDocument()
    expect(tenth).toBeEnabled()
    fireEvent.click(tenth)
    expect(live()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
    expect(within(grid).getAllByLabelText(/机位\d$/)).toHaveLength(9)
    // 关掉九宫格:格子销毁,侧栏回到刚才看的班
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '九宫格' })).toBeNull())
    expect(live()).toEqual(['m6'])
  })

  it('busy tile does not break others', async () => {
    const many = Array.from({ length: 9 }, (_, i) => cam(`m${i}`, `机位${i}`))
    vi.mocked(camerasApi.wall).mockResolvedValue(
      wallFixture({
        grades: [
          {
            grade_id: 'g3',
            grade_name: '三年级',
            classes: [{ class_id: 'c1', class_name: '三年一班', cameras: many }],
          },
        ],
        public: [],
      }),
    )
    const wall = await openWall()
    fireEvent.click(within(wall).getByRole('button', { name: '九宫格' }))
    const grid = within(await screen.findByRole('dialog', { name: '九宫格' })).getByTestId(
      'camera-wall-grid',
    )
    expect(live()).toHaveLength(9)
    const body = JSON.stringify({ error: { code: 'STREAM_BUSY', message: 'x' } })
    act(() =>
      FakeHls.instances[4].emit('hlsError', {
        details: 'manifestLoadError',
        fatal: true,
        response: { code: 503, text: body },
        networkDetails: { responseText: body },
      }),
    )
    act(() => FakeHls.instances[0].emit('hlsFragLoaded'))
    expect(within(grid).getAllByRole('alert')).toHaveLength(1)
    expect(within(grid).getByRole('alert')).toHaveTextContent('同时观看的摄像头太多')
    expect(within(grid).getAllByText('加载中')).toHaveLength(7)
    expect(within(grid).getAllByLabelText(/机位\d$/)).toHaveLength(9)
    expect(live()).toHaveLength(8)
  })

  it('hidden without camera perms', async () => {
    setPerms(['school.view', 'org.manage'])
    setup()
    const card = await screen.findByText('三年一班')
    expect(screen.queryByTestId('camera-wall')).toBeNull()
    expect(camerasApi.wall).not.toHaveBeenCalled()
    const grid = card.closest('[data-class-grid]') as HTMLElement
    for (const c of ['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4'])
      expect(grid).toHaveClass(c)
    cleanup()
    setPerms(['camera.manage'])
    setup()
    expect(await screen.findByTestId('camera-wall')).toBeInTheDocument()
    expect(camerasApi.wall).toHaveBeenCalledTimes(1)
  })

  it('collapses to a bar at the bottom below 1024 and expands on tap', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: 768 >= Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const wall = await openWall()
    const toggle = within(wall).getByRole('button', { name: /监控/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(wall).queryByTestId('camera-wall-class-c1')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(wall).getByTestId('camera-wall-class-c1')).toBeInTheDocument()
    fireEvent.click(within(wall).getByTestId('camera-wall-class-c1'))
    expect(live()).toEqual(['a1'])
    // 再收起:播放器也销毁
    fireEvent.click(toggle)
    expect(live()).toEqual([])
  })

  it('tells the admin when monitoring is switched off', async () => {
    vi.mocked(camerasApi.wall).mockRejectedValue(new ApiError(404, 'NOT_FOUND', '没有找到'))
    setup()
    const wall = await screen.findByTestId('camera-wall')
    expect(await within(wall).findByText('学校还没开启监控')).toBeInTheDocument()
  })
})
