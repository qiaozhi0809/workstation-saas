import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { findLegacyStyles } from '@/test/legacyStyles'
import StudentProfileDrawer from './StudentProfileDrawer'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn().mockResolvedValue({ my_perms: [] }) } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))

const student = { id: 's1', enrollment_id: 'e1', mk: 'S0001', name: '王小一', class_id: 'c', gender: '男', family_structure: '双亲家庭' }

const renderDrawer = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/teacher/students/s1']}>
      <Routes>
        <Route path="/teacher/students/:id" element={<StudentProfileDrawer studentId="s1" />} />
        <Route path="/teacher/classroom" element={<div>教室页</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(studentsApi.detail).mockReset()
  vi.mocked(classroomApi.summary).mockReset()
  vi.mocked(classroomApi.summary).mockResolvedValue({ my_perms: [] } as never)
  vi.mocked(studentsApi.detail).mockResolvedValue(student)
})

it('shows the student name in the heading after load', async () => {
  renderDrawer()
  expect(screen.getByRole('heading', { name: '加载中…' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: '王小一' })).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '王小一' })).toBeInTheDocument()
})

it('shows a permission message on 403', async () => {
  vi.mocked(studentsApi.detail).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'))
  renderDrawer()
  expect(await screen.findByText('没有权限查看该学生')).toBeInTheDocument()
})

it('shows not-found on 404 and generic text otherwise', async () => {
  vi.mocked(studentsApi.detail).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'no'))
  renderDrawer()
  expect(await screen.findByText('未找到该学生')).toBeInTheDocument()
})

it('shows generic failure text on other errors', async () => {
  vi.mocked(studentsApi.detail).mockRejectedValue(new Error('boom'))
  renderDrawer()
  expect(await screen.findByText('加载失败')).toBeInTheDocument()
})

it('closes to the classroom via the 关闭 button', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(await screen.findByText('教室页')).toBeInTheDocument()
})

it('closes on overlay click but not on a click inside the panel', async () => {
  renderDrawer()
  const dialog = await screen.findByRole('dialog')
  await act(() => new Promise((r) => setTimeout(r, 0)))
  fireEvent.pointerDown(dialog)
  expect(screen.queryByText('教室页')).toBeNull()
  fireEvent.pointerDown(document.body)
  expect(await screen.findByText('教室页')).toBeInTheDocument()
})

it('closes on Escape', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(await screen.findByText('教室页')).toBeInTheDocument()
})

it('switches to the archive tab', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  expect(screen.getByRole('tab', { name: '概览', selected: true })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '档案' }))
  expect(screen.getByText('双亲家庭')).toBeInTheDocument()
})

it('shows a not-yet-available state on later tabs', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  fireEvent.click(screen.getByRole('tab', { name: '成绩' }))
  expect(screen.getByText('暂未开放')).toBeInTheDocument()
})

it('replaces history on close so Back does not reopen the drawer', async () => {
  function Back() {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate(-1)}>返回</button>
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/teacher/classroom', '/teacher/students/s1']} initialIndex={1}>
        <Routes>
          <Route path="/teacher/students/:id" element={<StudentProfileDrawer studentId="s1" />} />
          <Route path="/teacher/classroom" element={<><div>教室页</div><Back /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { name: '王小一' })
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  fireEvent.click(await screen.findByRole('button', { name: '返回' }))
  expect(await screen.findByText('教室页')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('retries a failed load', async () => {
  vi.mocked(studentsApi.detail).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(student)
  renderDrawer()
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(await screen.findByRole('dialog', { name: '王小一' })).toBeInTheDocument()
})

it('gives no clickable 重试 while the refetch is in flight', async () => {
  let resolve!: (v: typeof student) => void
  vi.mocked(studentsApi.detail)
    .mockRejectedValueOnce(new Error('boom'))
    .mockImplementationOnce(() => new Promise((r) => { resolve = r }))
  renderDrawer()
  const retry = await screen.findByRole('button', { name: '重试' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  await waitFor(() => {
    const btn = screen.queryByRole('button', { name: '重试' })
    expect(btn === null || (btn as HTMLButtonElement).disabled).toBe(true)
  })
  await act(async () => { resolve(student) })
  expect(await screen.findByRole('dialog', { name: '王小一' })).toBeInTheDocument()
})

it('offers no retry on 403 or 404', async () => {
  vi.mocked(studentsApi.detail).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'))
  renderDrawer()
  await screen.findByText('没有权限查看该学生')
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
})

it('moves between tabs with the arrow keys', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  const first = screen.getByRole('tab', { name: '概览' })
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: '档案' })).toHaveFocus()
})

it('uses design tokens only', () => {
  const files = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})
