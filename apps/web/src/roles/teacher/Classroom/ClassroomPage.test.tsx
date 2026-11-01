import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { defaultApiMocks, setup } from './pageTestUtils'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

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
  expect(await screen.findByRole('button', { name: '王小一' })).toBeInTheDocument()
  expect(studentsApi.listInClass).toHaveBeenCalledWith('c1')
  expect(classroomApi.summary).toHaveBeenCalledWith('c1')
})

it('navigates to the student page when a seat is clicked', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  expect(await screen.findByTestId('loc')).toHaveTextContent('/teacher/students/s1')
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

it('enters presenting mode on fullscreen and hides the rail', async () => {
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: '班级概况' })).toBeNull()
})

it('shows grade, school year and week, and the teacher name plate', async () => {
  setup()
  expect(await screen.findByText('三年级 · 2026-2027 第 10 周')).toBeInTheDocument()
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
  await screen.findByRole('button', { name: '王小一' })
  expect(reviewsApi.summary).not.toHaveBeenCalled()
})

it('shows the rail on wide screens, toggles it, and hides it while presenting', async () => {
  window.innerWidth = 1280
  stubFullscreen()
  setup()
  expect(await screen.findByRole('complementary', { name: '班级概况' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '概况栏' }))
  expect(screen.queryByRole('complementary', { name: '班级概况' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '概况栏' }))
  expect(screen.getByRole('complementary', { name: '班级概况' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: '班级概况' })).toBeNull()
})

it('keeps the map when the summary fails and says why', async () => {
  vi.mocked(classroomApi.summary).mockRejectedValue(new Error('409'))
  setup()
  expect(await screen.findByText('班级概况加载失败')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '王小一' })).toBeInTheDocument()
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['日常'])
})

it('does not open a student profile from a seat while presenting', async () => {
  stubFullscreen()
  const { container } = setup()
  await screen.findByRole('button', { name: '王小一' })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '王小一' })).toBeNull()
  fireEvent.click(container.querySelector('[data-enrollment="e1"]') as Element)
  expect(screen.queryByTestId('loc')).toBeNull()
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
  await screen.findByText(/第 10 周/)
  expect(screen.queryByRole('button', { name: '编辑黑板' })).toBeNull()
})

it('keeps the loaded page when background refetches of classes, roster or attendance fail', async () => {
  const { client } = setup()
  await screen.findByRole('button', { name: '王小一' })
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
  expect(screen.getByRole('button', { name: '王小一' })).toBeInTheDocument()
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
  await screen.findByRole('button', { name: '王小一' })
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '王小一' }))
  expect(await screen.findByRole('dialog', { name: '点评 王小一' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
  expect(await screen.findByRole('button', { name: '全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '点评 王小一' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '李小二' }))
  expect(await screen.findByRole('dialog', { name: '点评 李小二' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全屏' }))
  expect(await screen.findByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '点评 李小二' })).toBeNull()
})
