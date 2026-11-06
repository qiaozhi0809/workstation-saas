import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { classFixture, defaultApiMocks, rosterFixture, setup } from './pageTestUtils'

const hoisted = vi.hoisted(() => ({
  seating: null as null | ((o: unknown) => unknown),
  onOpenLayout: undefined as undefined | (() => void),
  navigate: null as null | ReturnType<typeof import('vitest').vi.fn>,
}))
// 测试用的路由表里没有学生页,跳转改为记录调用
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate()
      return hoisted.navigate ?? real
    },
  }
})
// 默认走真实的排座逻辑;个别用例注入一个带 reload 的假实现,并记下页面传进去的 onOpenLayout
vi.mock('./seating/useSeatingMode', async (orig) => {
  const actual = await orig<typeof import('./seating/useSeatingMode')>()
  return {
    useSeatingMode: (
      o: Parameters<typeof actual.useSeatingMode>[0] & { onOpenLayout?: () => void },
    ) => {
      hoisted.onOpenLayout = o.onOpenLayout
      return hoisted.seating ? hoisted.seating(o) : actual.useSeatingMode(o)
    },
  }
})
// 对话框本身由自己的测试覆盖;这里只看页面怎么接它
vi.mock('./settings/ClassSettingsDialog', () => ({
  default: (p: {
    seatVersion: number
    onSaved(r: unknown): void
    onGo(to: string): void
    onClose(): void
  }) => (
    <div role="dialog" aria-label="班级设置对话框">
      <span>{`v${p.seatVersion}`}</span>
      <button
        onClick={() => {
          p.onSaved({ moved: 0 })
          p.onClose()
        }}
      >
        模拟保存
      </button>
      <button onClick={() => p.onGo('add')}>去添加</button>
      <button onClick={() => p.onGo('import')}>去导入</button>
      <button onClick={() => p.onGo('list')}>去名单</button>
    </div>
  ),
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
// 及格 / 优秀比例固定为默认值,不依赖 /school/grading 的真实请求失败后回退
vi.mock('@/shared/hooks/useGrading', async () => {
  const { DEFAULT_GRADING } = await import('@/shared/lib/grades')
  return { useGrading: () => DEFAULT_GRADING }
})

const WIDTH = window.innerWidth
const REQUEST_FULLSCREEN = Element.prototype.requestFullscreen
const EXIT_FULLSCREEN = document.exitFullscreen

function stubFullscreen() {
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  document.exitFullscreen = vi.fn(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
})

afterEach(() => {
  hoisted.navigate = null
  window.innerWidth = WIDTH
  Element.prototype.requestFullscreen = REQUEST_FULLSCREEN
  document.exitFullscreen = EXIT_FULLSCREEN
  delete (document as { fullscreenElement?: Element | null }).fullscreenElement
})

it('shows loading while my-classes is pending', () => {
  vi.mocked(classesApi.mine).mockReturnValue(new Promise(() => {}))
  setup()
  expect(screen.getByText('加载中…')).toBeInTheDocument()
})

it('shows empty message when no classes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [] })
  setup()
  expect(await screen.findByText('没有可查看的班级')).toBeInTheDocument()
})

it('shows loading when classes loaded but classId not yet selected', async () => {
  setup({ classId: null })
  await vi.waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(await screen.findByText('加载中…')).toBeInTheDocument()
  expect(studentsApi.listInClass).not.toHaveBeenCalled()
})

it('shows loading when classId is stale and not among my classes', async () => {
  setup({ classId: 'gone' })
  await vi.waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(await screen.findByText('加载中…')).toBeInTheDocument()
  expect(screen.queryByText('没有可查看的班级')).toBeNull()
  expect(studentsApi.listInClass).not.toHaveBeenCalled()
})

it('renders class title and seated students for the selected class', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: '三年二班' })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /^王小一，/ })).toBeInTheDocument()
  expect(studentsApi.listInClass).toHaveBeenCalledWith('c1')
  expect(classroomApi.summary).toHaveBeenCalledWith('c1')
})

it('opens the profile drawer (?student=) when a seat is clicked in daily mode', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: /^王小一，/ }))
  await vi.waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom\?student=s1$/),
  )
})

it('shows a class-list error when my-classes fails', async () => {
  vi.mocked(classesApi.mine).mockRejectedValue(new Error('500'))
  setup()
  expect(await screen.findByText('班级加载失败')).toBeInTheDocument()
  expect(studentsApi.listInClass).not.toHaveBeenCalled()
})

it('shows an error when the roster request fails', async () => {
  vi.mocked(studentsApi.listInClass).mockRejectedValue(new Error('403'))
  setup()
  expect(await screen.findByText('名单加载失败')).toBeInTheDocument()
})

it('enters presenting mode on fullscreen and hides 待办与点评', async () => {
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '待办与点评' })).toBeNull()
})

it('uses an opaque background on the root while presenting, so the black backdrop never shows through', async () => {
  stubFullscreen()
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
  await screen.findByRole('button', { name: '退出全屏' })
  const classes = (document.fullscreenElement as Element).className.split(/\s+/)
  expect(classes).toContain('bg-background')
  expect(classes.filter((c) => c.startsWith('bg-') && c.includes('/'))).toEqual([])
})

it('shows the teacher name plate and the class and date line', async () => {
  setup()
  expect(await screen.findByText('王老师 · 班主任')).toBeInTheDocument()
  expect(await screen.findByText('三年二班 · 11月2日 星期一')).toBeInTheDocument()
})

it('labels a subject teacher and offers only the modes they may use', async () => {
  setup({ perms: ['attendance.read', 'review.read', 'review.write'] })
  expect(await screen.findByText('王老师 · 任课老师')).toBeInTheDocument()
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常', '考勤', '点评'])
})

it('switches modes from the tab bar', async () => {
  setup()
  fireEvent.click(await screen.findByRole('tab', { name: '考勤' }))
  expect(screen.getByRole('tab', { name: '考勤' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: '日常' })).toHaveAttribute('aria-selected', 'false')
})

it('opens in the mode setup asks for', async () => {
  setup({ mode: '考勤' })
  expect(await screen.findByRole('tab', { name: '考勤' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  expect(screen.getByRole('tab', { name: '日常' })).toHaveAttribute('aria-selected', 'true')
})

it('falls back to daily when the requested mode is not permitted', async () => {
  setup({ mode: '排座', perms: ['attendance.read', 'review.read'] })
  expect(await screen.findByRole('tab', { name: '日常' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: '排座' })).toBeNull()
})

it('loads weekly stars only for teachers who may read reviews', async () => {
  setup({ perms: ['attendance.read'] })
  await screen.findByRole('button', { name: /^王小一，/ })
  expect(reviewsApi.summary).not.toHaveBeenCalled()
})

it('has no overview rail at any width; 待办与点评 opens a drawer that is hidden while presenting', async () => {
  for (const w of [1280, 1024]) {
    window.innerWidth = w
    const { unmount } = setup()
    await screen.findByRole('button', { name: '待办与点评' })
    expect(screen.queryByRole('complementary')).toBeNull()
    unmount()
  }
  window.innerWidth = 1280
  stubFullscreen()
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '待办与点评' }))
  expect(await screen.findByRole('dialog', { name: '待办与点评' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '待办与点评' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '待办与点评' })).toBeNull()
})

it('keeps the map when the summary fails and says why', async () => {
  vi.mocked(classroomApi.summary).mockRejectedValue(new Error('409'))
  setup()
  expect(await screen.findByText('班级概况加载失败')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^王小一，/ })).toBeInTheDocument()
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常'])
})

it('does not open a student profile from a seat while presenting', async () => {
  stubFullscreen()
  const { container } = setup()
  await screen.findByRole('button', { name: /^王小一，/ })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^王小一，/ })).toBeNull()
  fireEvent.click(container.querySelector('[data-enrollment="e1"]') as Element)
  expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom$/)
  expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
})

it('shows 编辑黑板 only with board.write and opens the editor', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '编辑黑板' }))
  expect(screen.getByRole('dialog', { name: '编辑黑板' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '编辑黑板' })).toBeNull()
})

it('hides 编辑黑板 without board.write', async () => {
  setup({ perms: ['review.write'] })
  await screen.findByRole('toolbar', { name: '教室工具' })
  // 名牌只有在概况(summary)加载后才带身份后缀(label 依赖 summary.data / my_perms),所以它出现即权限已到
  await screen.findByText('王老师 · 任课老师')
  expect(screen.queryByRole('button', { name: '编辑黑板' })).toBeNull()
})

it('keeps the loaded page when background refetches of classes, roster or attendance fail', async () => {
  const { client } = setup()
  await screen.findByRole('button', { name: /^王小一，/ })
  expect(await screen.findByRole('button', { name: '随机点名' })).toBeEnabled()
  vi.mocked(classesApi.mine).mockRejectedValue(new Error('500'))
  vi.mocked(studentsApi.listInClass).mockRejectedValue(new Error('500'))
  vi.mocked(attendanceApi.day).mockRejectedValue(new Error('500'))
  await act(() => client.refetchQueries())
  await waitFor(() => {
    for (const key of [
      ['my-classes'],
      ['class-students', 'c1'],
      ['attendance', 'c1', '2026-11-02'],
    ]) {
      expect(client.getQueryState(key)?.status).toBe('error')
    }
  })
  expect(screen.queryByText('班级加载失败')).toBeNull()
  expect(screen.queryByText('名单加载失败')).toBeNull()
  expect(screen.getByRole('heading', { name: '三年二班' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^王小一，/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '随机点名' })).toBeEnabled()
})

const leaveE1 = () =>
  vi.mocked(attendanceApi.day).mockImplementation(async (_c, date) => ({
    date,
    confirmed_at: null,
    items: [
      {
        enrollment_id: 'e1',
        status: 'leave' as const,
        reason: null,
        marked_at: '2026-11-02T01:00:00Z',
      },
    ],
  }))

it('does not project attendance in daily or review mode while presenting', async () => {
  leaveE1()
  stubFullscreen()
  setup()
  expect(await screen.findByText('请假')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByText('请假')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '点评' }))
  await screen.findByRole('button', { name: '全班 +1' })
  expect(screen.queryByText('请假')).toBeNull()
  // 考勤模式是老师主动选的,投屏时照样显示
  fireEvent.click(screen.getByRole('tab', { name: '考勤' }))
  expect(await screen.findByText('请假')).toBeInTheDocument()
})

it('lets the teacher review while presenting and closes the popover when presenting toggles', async () => {
  stubFullscreen()
  setup({ mode: '点评' })
  await screen.findByRole('button', { name: /^王小一，/ })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^王小一，/ }))
  expect(await screen.findByRole('dialog', { name: '点评 王小一' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
  expect(await screen.findByRole('button', { name: '全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '点评 王小一' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^李小二，/ }))
  expect(await screen.findByRole('dialog', { name: '点评 李小二' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '点评 李小二' })).toBeNull()
})

const hoverCard = async (container: HTMLElement, seat: string) => {
  fireEvent.mouseEnter(container.querySelector(`[data-seat="${seat}"]`) as Element)
  return waitFor(() => {
    const card = container.querySelector('.cr-hovercard')
    expect(card).not.toBeNull()
    return card as HTMLElement
  })
}

it("shows number, role, today's attendance and this week's points in the hover card", async () => {
  leaveE1()
  vi.mocked(reviewsApi.summary).mockResolvedValue({
    week_start: '2026-11-02',
    items: [
      { enrollment_id: 'e1', total: 5, week: 3, plus_count: 5, minus_count: 0 },
      { enrollment_id: 'e2', total: 0, week: 0, plus_count: 0, minus_count: 0 },
    ],
  })
  const { container } = setup({
    roster: rosterFixture.map((s) => (s.enrollment_id === 'e1' ? { ...s, class_role: '班长' } : s)),
  })
  await screen.findByText('请假')
  const card = await hoverCard(container, '1-1')
  expect(within(card).getByText('王小一')).toBeInTheDocument()
  expect(within(card).getByText('学号 2026001')).toBeInTheDocument()
  expect(within(card).getByText('班长')).toBeInTheDocument()
  expect(within(card).getByText('今日考勤 请假')).toBeInTheDocument()
  expect(await within(card).findByText('本周积分 +3')).toBeInTheDocument()
  fireEvent.mouseEnter(container.querySelector('[data-seat="1-2"]') as Element)
  expect(await within(container).findByText('今日考勤 出勤')).toBeInTheDocument()
  expect(within(container).getByText('本周积分 0')).toBeInTheDocument()
})

it('leaves weekly points out of the hover card without review.read', async () => {
  const { container } = setup({ perms: ['attendance.read'] })
  await screen.findByRole('button', { name: /^王小一，/ })
  await waitFor(() => expect(attendanceApi.day).toHaveBeenCalled())
  const card = await hoverCard(container, '1-1')
  expect(await within(card).findByText('今日考勤 出勤')).toBeInTheDocument()
  expect(within(card).queryByText(/本周积分/)).toBeNull()
})

it('retries loading the class list', async () => {
  vi.mocked(classesApi.mine)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ items: [classFixture] })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(await screen.findByRole('heading', { name: classFixture.name })).toBeInTheDocument()
})

it('retries loading the roster', async () => {
  vi.mocked(studentsApi.listInClass)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ items: rosterFixture })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(await screen.findByLabelText('教室座位图')).toBeInTheDocument()
})

it('explains what to do when there are no classes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [] })
  setup()
  expect(await screen.findByText('请联系学校管理员为你分配班级')).toBeInTheDocument()
})

it('puts the dock below the stage and the zoom controls on the stage', async () => {
  setup()
  const stage = await screen.findByTestId('classroom-stage')
  const bar = screen.getByRole('toolbar', { name: '教室工具' })
  expect(stage.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(bar).getByRole('tablist', { name: '教室模式' })).toBeInTheDocument()
  expect(await within(stage).findByRole('group', { name: '缩放' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '三年二班' })).toHaveClass('sr-only')
})

it('keeps the dock inside the fullscreen root while presenting', async () => {
  stubFullscreen()
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
  await screen.findByRole('button', { name: '退出全屏' })
  expect(
    (document.fullscreenElement as Element).contains(
      screen.getByRole('tablist', { name: '教室模式' }),
    ),
  ).toBe(true)
})

it('keeps other search params when switching modes', async () => {
  setup({ search: '?foo=1&bar=2' })
  fireEvent.click(await screen.findByRole('tab', { name: '点评' }))
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/teacher/classroom?foo=1&bar=2&mode=review',
    ),
  )
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  await waitFor(() =>
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom\?foo=1&bar=2$/),
  )
})

const moreMenu = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '更多操作' }))
}

it('offers class settings in the more menu for homeroom teachers in every mode', async () => {
  setup()
  await moreMenu()
  expect(await screen.findByRole('menuitem', { name: '班级设置' })).toBeInTheDocument()
})

it('does not offer class settings without seating.write', async () => {
  setup({ perms: ['attendance.read', 'review.read'] })
  await screen.findByRole('button', { name: '待办与点评' })
  expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull()
})

it('opens the dialog with the seat version and routes its onGo targets', async () => {
  const navigate = (hoisted.navigate = vi.fn())
  setup()
  await moreMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
  expect(await screen.findByText('v4')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '去添加' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teacher/students?action=add'))
})

it('routes 去导入 and 去名单 to the students page', async () => {
  const navigate = (hoisted.navigate = vi.fn())
  setup()
  await moreMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
  fireEvent.click(await screen.findByRole('button', { name: '去导入' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teacher/students?action=import'))
  fireEvent.click(await screen.findByRole('button', { name: '去名单' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teacher/students'))
})

it('refreshes queries and reloads the seating draft after saving the layout', async () => {
  const reload = vi.fn().mockResolvedValue(undefined)
  hoisted.seating = () => ({
    ready: false,
    failed: false,
    dirty: false,
    pending: null,
    retry: vi.fn(),
    reload,
  })
  try {
    const { client } = setup({ mode: '排座' })
    const spy = vi.spyOn(client, 'invalidateQueries')
    await moreMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
    fireEvent.click(await screen.findByRole('button', { name: '模拟保存' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    for (const k of [['my-classes'], ['classroom', 'c1'], ['class-students', 'c1']]) {
      expect(spy).toHaveBeenCalledWith({ queryKey: k })
    }
    expect(typeof hoisted.onOpenLayout).toBe('function')
  } finally {
    hoisted.seating = null
  }
})

it('does not reload the seating draft after saving outside the seating mode', async () => {
  const reload = vi.fn().mockResolvedValue(undefined)
  hoisted.seating = () => ({
    ready: false,
    failed: false,
    dirty: false,
    pending: null,
    retry: vi.fn(),
    reload,
  })
  try {
    setup()
    await moreMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
    fireEvent.click(await screen.findByRole('button', { name: '模拟保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '班级设置对话框' })).toBeNull())
    expect(reload).not.toHaveBeenCalled()
  } finally {
    hoisted.seating = null
  }
})

it('passes desk size and podium seats to the map', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [{ ...classFixture, desk_size: 3, podium_left: 1, seat_cols: 6 }],
  })
  const { container } = setup()
  await waitFor(() => expect(container.querySelector('[data-seat="0--1"]')).not.toBeNull())
})

it('disables class settings in the menu while the seating draft is dirty', async () => {
  hoisted.seating = () => ({
    ready: false,
    failed: false,
    dirty: true,
    pending: null,
    retry: vi.fn(),
  })
  try {
    setup({ mode: '排座' })
    await moreMenu()
    const item = await screen.findByRole('menuitem', { name: /班级设置/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('先保存或放弃当前的座位修改')
    fireEvent.click(item)
    expect(screen.queryByRole('dialog', { name: '班级设置对话框' })).toBeNull()
  } finally {
    hoisted.seating = null
  }
})

it('also invalidates the students page records after saving the layout', async () => {
  const { client } = setup()
  const spy = vi.spyOn(client, 'invalidateQueries')
  await moreMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
  fireEvent.click(await screen.findByRole('button', { name: '模拟保存' }))
  expect(spy).toHaveBeenCalledWith({ queryKey: ['student-records', 'c1'] })
})

it('refreshes my-classes before navigating to the students page', async () => {
  const navigate = (hoisted.navigate = vi.fn())
  setup()
  await moreMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: '班级设置' }))
  await screen.findByRole('button', { name: '去添加' })
  let release!: (v: { items: (typeof classFixture)[] }) => void
  vi.mocked(classesApi.mine).mockReturnValue(
    new Promise((r) => {
      release = r
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '去添加' }))
  await waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(navigate).not.toHaveBeenCalled()
  release({ items: [classFixture] })
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/teacher/students?action=add'))
})

it('colors the hover card avatar with the map group of three-seat desks and podium seats', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({
    items: [{ ...classFixture, desk_size: 3, seat_cols: 9, podium_right: 1 }],
  })
  const roster = [
    { ...rosterFixture[0], seat_row: 1, seat_col: 4 },
    { ...rosterFixture[1], seat_row: 0, seat_col: 1 },
  ]
  const { container } = setup({ roster })
  await screen.findByRole('button', { name: /^王小一，/ })
  // 三人桌第 4 列属第 2 组;讲台右侧座位属最后一组(第 3 组)
  const card1 = await hoverCard(container, '1-4')
  expect(card1.innerHTML).toContain('#f08a5d')
  expect(card1.innerHTML).not.toContain('#3fb8a9')
  fireEvent.mouseLeave(container.querySelector('[data-seat="1-4"]') as Element)
  const card2 = await hoverCard(container, '0-1')
  expect(card2.innerHTML).toContain('#8b7cf6')
})

// 班级是双人桌;排座草稿已改为三人桌、9 列:第 3 列按草稿属第 1 组(groupOf(3, 3) = 0),按双人桌会算成第 2 组
const draftSeating = (seat: (typeof rosterFixture)[number]) => () => ({
  ready: true,
  dirty: false,
  pending: null,
  seats: [seat],
  rows: 2,
  cols: 9,
  deskSize: 3,
  podium: { left: 0, right: 0 },
  views: {},
  onSeatClick: undefined,
  onEmptySeatClick: undefined,
  onSeatDrop: undefined,
  reload: vi.fn(),
  bar: {
    deskSize: 3,
    layoutBlocked: false,
    canUndo: false,
    dirty: false,
    busy: false,
    selected: null,
    conflict: false,
    canMentor: false,
    onShuffle: vi.fn(),
    onPair: vi.fn(),
    onMentor: vi.fn(),
    onUndo: vi.fn(),
    onDiscard: vi.fn(),
    onToggleLock: vi.fn(),
    onPrint: vi.fn(),
    onSave: vi.fn(),
    onReload: vi.fn(),
    onKeepEditing: vi.fn(),
  },
  tray: {
    students: [],
    selectedId: null,
    canUnseat: false,
    busy: false,
    seedOf: (id: string) => id,
    onSelect: vi.fn(),
    onUnseat: vi.fn(),
  },
})

it('hover card group follows the draft desk size', async () => {
  const seat = { ...rosterFixture[0], seat_row: 1, seat_col: 3 }
  hoisted.seating = draftSeating(seat)
  try {
    const { container } = setup({ mode: '排座', roster: [seat] })
    await waitFor(() => expect(container.querySelector('[data-seat="1-3"]')).not.toBeNull())
    const card = await hoverCard(container, '1-3')
    expect(card.innerHTML).toContain('#3fb8a9')
    expect(card.innerHTML).not.toContain('#f08a5d')
  } finally {
    hoisted.seating = null
  }
})

it('pick card group follows the draft desk size', async () => {
  // 随机点名只在非排座模式可用(进入排座会收起点名),真实运行里点名卡不会和就绪的草稿同时出现;
  // 这里用就绪的草稿 mock 在日常模式点名,只验证点名卡拿到的是与悬停卡同一个 mapGroup(草稿口径)
  const seat = { ...rosterFixture[0], seat_row: 1, seat_col: 3 }
  hoisted.seating = draftSeating(seat)
  const original = window.matchMedia
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }) as never
  try {
    setup({ roster: [seat] })
    fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
    const card = await screen.findByRole('dialog', { name: '随机点名' })
    expect(card.innerHTML).toContain('#3fb8a9')
    expect(card.innerHTML).not.toContain('#f08a5d')
  } finally {
    hoisted.seating = null
    window.matchMedia = original
  }
})

it('falls back to double desks when the class has no desk size yet', async () => {
  const legacy = { ...classFixture, desk_size: undefined } as unknown as typeof classFixture
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [legacy] })
  const { container } = setup({ roster: [{ ...rosterFixture[0], seat_row: 1, seat_col: 1 }] })
  await screen.findByRole('button', { name: /^王小一，/ })
  const card = await hoverCard(container, '1-1')
  expect(card.innerHTML).toContain('#3fb8a9')
})
