import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import StudentProfileDrawer from './StudentProfileDrawer'

vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn() } }))

const student = { id: 's1', mk: 'S0001', name: '王小一', class_id: 'c', gender: '男', family_structure: '双亲家庭' }

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
  fireEvent.click(dialog)
  expect(screen.queryByText('教室页')).toBeNull()
  fireEvent.click(dialog.parentElement as HTMLElement)
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

it('shows M2 启用 on a later-milestone tab', async () => {
  renderDrawer()
  await screen.findByRole('heading', { name: '王小一' })
  fireEvent.click(screen.getByRole('tab', { name: '成绩' }))
  expect(screen.getByText('M2 启用')).toBeInTheDocument()
})
