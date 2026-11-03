import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import type { Account, ClassAdmin } from '@/shared/types/admin'
import ClassInfoPage from './ClassInfoPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    class: vi.fn(), updateClass: vi.fn(), grades: vi.fn(), accounts: vi.fn(),
    addStaff: vi.fn(), endStaff: vi.fn(),
  },
}))
const api = vi.mocked(adminApi)

const cls: ClassAdmin = {
  id: 'c1', name: '三年二班', grade_id: 'g3', grade_name: '三年级', room: '301', student_count: 40,
  homeroom: { assignment_id: 'a1', user_id: 'u1', display_name: '李老师' }, assistants: [],
  subjects: [{ subject: '语文', teachers: [{ assignment_id: 'a2', user_id: 'u2', display_name: '王老师' }] }],
  desk_size: 2, seat_layout: 'auto', seat_rows: 6, seat_cols: 4, podium_left: 0, podium_right: 0,
}
const acc: Account = {
  id: 'u5', login_name: 'teacher05', display_name: '赵老师', phone: '13800000005', employee_no: null,
  subjects: ['数学'], status: 'active', must_change_password: false, last_login_at: null, roles: [],
}

beforeEach(() => {
  api.class.mockResolvedValue(cls)
  api.grades.mockResolvedValue([{ id: 'g3', name: '三年级', stage: null, effective_stage: '小学', display_order: 3, class_count: 1 }])
  api.accounts.mockResolvedValue({ items: [acc, { ...acc, id: 'u6', display_name: '冻结老师', status: 'frozen' }], total: 2 })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin/org/classes/c1']}>
      <Routes><Route path="/admin/org/classes/:id" element={<ClassInfoPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)

it('disables 添加 for a subject teacher until a subject is chosen', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '添加任课老师' }))
  fireEvent.click(await screen.findByRole('button', { name: /赵老师/ }))
  expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('科目'), { target: { value: '数学' } })
  expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  expect(screen.queryByText(/冻结老师/)).toBeNull()
})

it('asks for confirmation naming the outgoing homeroom teacher', async () => {
  api.addStaff.mockResolvedValue(cls)
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '更换班主任' }))
  fireEvent.click(await screen.findByRole('button', { name: /赵老师/ }))
  fireEvent.click(screen.getByRole('button', { name: '添加' }))
  expect(await screen.findByText(/原班主任 李老师 将卸任/)).toBeInTheDocument()
  expect(api.addStaff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认更换' }))
  await waitFor(() => expect(api.addStaff).toHaveBeenCalledWith('c1', { user_id: 'u5', identity: 'homeroom', subject: null }))
})

it('summarises the desk layout', async () => {
  renderPage()
  expect(await screen.findByText('6 排 × 4 个座位 + 讲台边 0 个')).toBeInTheDocument()
  expect(screen.getByText('每桌 2 人')).toBeInTheDocument()
})

it('shows the stage read-only', async () => {
  renderPage()
  expect(await screen.findByText('小学')).toBeInTheDocument()
})
