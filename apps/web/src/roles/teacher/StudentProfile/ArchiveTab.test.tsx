import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { Toaster } from '@/shared/components/Toast'
import type { ClassView } from '@/shared/types/class'
import type { StudentProfile } from '@/shared/types/student'
import ArchiveTab from './ArchiveTab'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { saveMyNotes: vi.fn() } }))

const bare: StudentProfile = { id: 's', enrollment_id: 'e1', mk: 'S0002', name: '李小二', class_id: 'c' }
const klass = (role: ClassView['role']): ClassView => ({ id: 'c', name: '一班', grade_name: '七年级', seat_rows: 6, seat_cols: 8, desk_size: 2, seat_layout: 'manual', seat_order: 'row', podium_left: 0, podium_right: 0, room: '', role })

function renderTab(student: StudentProfile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ArchiveTab student={student} /><Toaster /></QueryClientProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [klass('subject_teacher')] })
})

it('shows 暂无 placeholder when optional fields are missing', () => {
  renderTab(bare)
  expect(screen.getAllByText('暂无').length).toBe(8)
  expect(screen.queryByText(/null|undefined/)).toBeNull()
})

it('treats blank strings as missing', () => {
  renderTab({ ...bare, family_structure: '   ' })
  expect(screen.getAllByText('暂无').length).toBe(8)
})

it('lists contacts with copy buttons', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderTab({
    ...bare, boarding: true, family_note: '奶奶接送', note: '怕黑',
    contacts: [
      { name: '李大', relation: '父亲', phone: '13800000011', job: '工程师' },
      { name: '赵美', relation: '母亲', phone: '13800000012', job: '' },
    ],
  })
  expect(screen.getByText('李大')).toBeInTheDocument()
  expect(screen.getByText('父亲')).toBeInTheDocument()
  expect(screen.getByText('13800000011')).toBeInTheDocument()
  expect(screen.getByText('工程师')).toBeInTheDocument()
  expect(screen.getByText('奶奶接送')).toBeInTheDocument()
  expect(screen.getByText('怕黑')).toBeInTheDocument()
  expect(screen.getByText('住校')).toBeInTheDocument()
  const copies = screen.getAllByRole('button', { name: '复制电话' })
  expect(copies).toHaveLength(2)
  fireEvent.click(copies[1])
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('13800000012'))
  expect(await screen.findByText('已复制电话')).toBeInTheDocument()
})

it('shows my notes for the homeroom teacher of the class', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [klass('homeroom_teacher')] })
  renderTab({ ...bare, teacher_notes: { text: '细心', updated_at: new Date(2026, 10, 2, 9, 5).toISOString() } })
  expect(await screen.findByText('我的笔记')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('细心')
})

it('hides my notes for a subject teacher', async () => {
  renderTab(bare)
  await waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(screen.queryByText('我的笔记')).toBeNull()
})
