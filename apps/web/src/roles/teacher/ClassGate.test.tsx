import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import { summaryFixture } from './Classroom/pageTestUtils'
import ClassGate, { type ClassContext } from './ClassGate'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))

const cls: ClassView = {
  id: 'c1',
  name: '三年二班',
  grade_name: '三年级',
  seat_rows: 6,
  seat_cols: 4,
  desk_size: 2,
  seat_layout: 'manual',
  seat_order: 'row',
  podium_left: 0,
  podium_right: 0,
  room: '',
  role: 'subject_teacher',
}

const renderGate = (
  need?: 'exam.read',
  children: (ctx: ClassContext) => React.ReactNode = () => <p>内容</p>,
) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ClassGate title="成绩录入" need={need}>
          {children}
        </ClassGate>
      </MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  useTeacherStore.setState({ classId: 'c1' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({ my_perms: ['exam.read'], my_subjects: ['数学'] }),
  )
})

it('shows the permission empty state when the class lacks the needed perm', async () => {
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({ my_perms: ['attendance.read'] }),
  )
  renderGate('exam.read')
  expect(await screen.findByText('你在本班没有这项权限')).toBeInTheDocument()
  expect(screen.queryByText('内容')).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: '成绩录入' })).toHaveClass('sr-only')
})

it('passes class, summary, perms and subjects to children', async () => {
  const seen = vi.fn()
  renderGate('exam.read', (ctx) => {
    seen(ctx)
    return <p>内容</p>
  })
  expect(await screen.findByText('内容')).toBeInTheDocument()
  const ctx = seen.mock.calls.at(-1)![0] as ClassContext
  expect(ctx.cls).toEqual(cls)
  expect(ctx.summary.my_subjects).toEqual(['数学'])
  expect(ctx.perms).toEqual(['exam.read'])
  expect(ctx.subjects).toEqual(['数学'])
  expect(screen.getByRole('heading', { level: 1, name: '成绩录入' })).toBeInTheDocument()
  expect(classroomApi.summary).toHaveBeenCalledWith('c1')
})

it('renders children without any perm check when need is omitted', async () => {
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({ my_perms: [], my_subjects: [] }),
  )
  renderGate(undefined)
  expect(await screen.findByText('内容')).toBeInTheDocument()
})

it('shows loading, then an error with retry when the class list fails', async () => {
  vi.mocked(classesApi.mine)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce({ items: [cls] })
  renderGate()
  expect(screen.getByText('加载中…')).toBeInTheDocument()
  const retry = await screen.findByRole('button', { name: '重试' })
  expect(screen.getByText('班级加载失败')).toBeInTheDocument()
  retry.click()
  expect(await screen.findByText('内容')).toBeInTheDocument()
})

it('shows an error with retry when the class summary fails', async () => {
  vi.mocked(classroomApi.summary).mockRejectedValue(new Error('boom'))
  renderGate()
  expect(await screen.findByText('班级概况加载失败')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('shows the no-class state when the teacher has no classes', async () => {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [] })
  renderGate()
  expect(await screen.findByText('没有可查看的班级')).toBeInTheDocument()
})
