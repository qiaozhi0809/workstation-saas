import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { Toaster } from '@/shared/components/Toast'
import type { ClassPerm } from '@/shared/types/classroom'
import type { StudentProfile } from '@/shared/types/student'
import { summaryFixture } from '../Classroom/pageTestUtils'
import OverviewTab, { CLASS_ROLE_PRESETS } from './OverviewTab'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { setClassRole: vi.fn() } }))

const profile: StudentProfile = { id: 's1', mk: 'S0001', name: '王小一', class_id: 'c1', enrollment_id: 'e1' }

function renderTab({ perms, student }: { perms: ClassPerm[]; student: StudentProfile }) {
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: perms }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><OverviewTab student={student} /><Toaster /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(studentsApi.setClassRole).mockResolvedValue({ enrollment_id: 'e1', class_role: null })
})

it('lets the homeroom teacher set a class role', async () => {
  const { invalidate } = renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: undefined } })
  fireEvent.change(await screen.findByLabelText('职务'), { target: { value: '体育委员' } })
  await waitFor(() => expect(studentsApi.setClassRole).toHaveBeenCalledWith('c1', 'e1', '体育委员'))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student', 's1'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['class-students', 'c1'] })
  fireEvent.change(screen.getByLabelText('职务'), { target: { value: '' } })
  await waitFor(() => expect(studentsApi.setClassRole).toHaveBeenLastCalledWith('c1', 'e1', null))
})

it('lists 无, the presets, and a current value that is not a preset', async () => {
  renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: '图书管理员' } })
  const select = await screen.findByLabelText('职务')
  const options = within(select).getAllByRole('option').map((o) => o.textContent)
  expect(options).toEqual(['无', ...CLASS_ROLE_PRESETS, '图书管理员'])
  expect(select).toHaveValue('图书管理员')
})

it('shows the class role read-only for other teachers', async () => {
  renderTab({ perms: ['review.write'], student: { ...profile, class_role: '班长' } })
  expect(await screen.findByText('班长')).toBeInTheDocument()
  expect(screen.queryByLabelText('职务')).toBeNull()
})

it('shows 暂无 when read-only and empty', async () => {
  renderTab({ perms: [], student: profile })
  await waitFor(() => expect(classroomApi.summary).toHaveBeenCalled())
  expect(screen.getByText('职务').nextElementSibling).toHaveTextContent('暂无')
})

it('reverts the select and toasts the server error on failure', async () => {
  vi.mocked(studentsApi.setClassRole).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '没有权限'))
  renderTab({ perms: ['student.write_basic'], student: { ...profile, class_role: '班长' } })
  fireEvent.change(await screen.findByLabelText('职务'), { target: { value: '小组长' } })
  expect(await screen.findByText('没有权限')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('职务')).toHaveValue('班长'))
})
