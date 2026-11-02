import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { classFixture, defaultApiMocks, rosterFixture, setup } from './pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')
vi.mock('@/shared/api/exams')

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
  await vi.waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom\?student=s1$/))
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
    for (const key of [['my-classes'], ['class-students', 'c1'], ['attendance', 'c1', '2026-11-02']]) {
      expect(client.getQueryState(key)?.status).toBe('error')
    }
  })
  expect(screen.queryByText('班级加载失败')).toBeNull()
  expect(screen.queryByText('名单加载失败')).toBeNull()
  expect(screen.getByRole('heading', { name: '三年二班' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^王小一，/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '随机点名' })).toBeEnabled()
})

const leaveE1 = () => vi.mocked(attendanceApi.day).mockImplementation(async (_c, date) => ({ date, confirmed_at: null,
  items: [{ enrollment_id: 'e1', status: 'leave' as const, reason: null, marked_at: '2026-11-02T01:00:00Z' }] }))

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

it('shows number, role, today\'s attendance and this week\'s points in the hover card', async () => {
  leaveE1()
  vi.mocked(reviewsApi.summary).mockResolvedValue({ week_start: '2026-11-02', items: [
    { enrollment_id: 'e1', total: 5, week: 3, plus_count: 5, minus_count: 0 },
    { enrollment_id: 'e2', total: 0, week: 0, plus_count: 0, minus_count: 0 },
  ] })
  const { container } = setup({ roster: rosterFixture.map((s) => (s.enrollment_id === 'e1' ? { ...s, class_role: '班长' } : s)) })
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
  vi.mocked(classesApi.mine).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [classFixture] })
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
  expect((document.fullscreenElement as Element).contains(screen.getByRole('tablist', { name: '教室模式' }))).toBe(true)
})

it('keeps other search params when switching modes', async () => {
  setup({ search: '?foo=1&bar=2' })
  fireEvent.click(await screen.findByRole('tab', { name: '点评' }))
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/teacher/classroom?foo=1&bar=2&mode=review'))
  fireEvent.click(screen.getByRole('tab', { name: '日常' }))
  await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/classroom\?foo=1&bar=2$/))
})
