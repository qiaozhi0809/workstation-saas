import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { studentsApi } from '@/shared/api/students'
import { useTeacherStore } from '@/shared/stores/teacher'
import ClassroomPage from './ClassroomPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))

const cls = { id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 3, seat_cols: 4, role: 'homeroom_teacher' as const }
const seat = (id: string, name: string, row: number, col: number) => ({
  enrollment_id: 'e' + id, student_id: id, name, mk: 'S' + id, seat_row: row, seat_col: col, avatar_seed: null,
})

function Loc() { return <div data-testid="loc">{useLocation().pathname}</div> }

function setup() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/teacher/classroom']}>
        <Routes>
          <Route path="/teacher/classroom" element={<ClassroomPage />} />
          <Route path="/teacher/students/:id" element={<Loc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: [] })
  act(() => useTeacherStore.setState({ classId: 'c1' }))
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
  act(() => useTeacherStore.setState({ classId: null }))
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  setup()
  await vi.waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(await screen.findByText('加载中…')).toBeInTheDocument()
  expect(studentsApi.listInClass).not.toHaveBeenCalled()
})

it('shows loading when classId is stale and not among my classes', async () => {
  act(() => useTeacherStore.setState({ classId: 'gone' }))
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  setup()
  await vi.waitFor(() => expect(classesApi.mine).toHaveBeenCalled())
  expect(await screen.findByText('加载中…')).toBeInTheDocument()
  expect(screen.queryByText('没有可查看的班级')).toBeNull()
})

it('renders class title and seated students for the selected class', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: [seat('s1', '王小一', 1, 1)] })
  setup()
  expect(await screen.findByRole('heading', { name: '三年二班' })).toBeInTheDocument()
  expect(await screen.findByText('王小一')).toBeInTheDocument()
  expect(studentsApi.listInClass).toHaveBeenCalledWith('c1')
})

it('navigates to the student page when a seat is clicked', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: [seat('s1', '王小一', 1, 1)] })
  setup()
  fireEvent.click(await screen.findByText('王小一'))
  expect(await screen.findByTestId('loc')).toHaveTextContent('/teacher/students/s1')
})

it('shows an error when the roster request fails', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(studentsApi.listInClass).mockRejectedValue(new Error('403'))
  setup()
  expect(await screen.findByText('名单加载失败')).toBeInTheDocument()
})
