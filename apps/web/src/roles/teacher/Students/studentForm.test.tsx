import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { schoolApi } from '@/shared/api/school'
import { studentsApi } from '@/shared/api/students'
import { DEFAULT_TAG_POOL } from '@/shared/lib/tags'
import type { ClassView } from '@/shared/types/class'
import type { StudentSeat } from '@/shared/types/student'
import { rec } from './fixtures'
import StudentForm, { nextStudentNo } from './StudentForm'

vi.mock('@/shared/api/students', () => ({
  studentsApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { tagPool: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const cls: ClassView = {
  id: 'c1',
  name: '三年二班',
  grade_name: '三年级',
  seat_rows: 2,
  seat_cols: 2,
  desk_size: 2,
  seat_layout: 'manual',
  seat_order: 'row',
  podium_left: 0,
  podium_right: 0,
  room: '',
  role: 'homeroom_teacher',
}
const roster = [
  rec({ enrollment_id: 'e1', name: '张三', student_no: '2026009', seat_row: 1, seat_col: 1 }),
  rec({
    enrollment_id: 'e2',
    name: '李四',
    student_no: '2026010',
    seat_row: 1,
    seat_col: 2,
    seat_locked: true,
  }),
  rec({
    enrollment_id: 'e3',
    name: '王五',
    student_no: '2026003',
    seat_row: 2,
    seat_col: 1,
    tags: ['爱画画', '近视'],
    contacts: [{ name: '王父', relation: '父亲', phone: '13800000003', job: '' }],
    boarding: false,
  }),
]

const ROSTER_KEYS = [
  'student-records',
  'class-students',
  'classroom',
  'gradebook',
  'student',
  'exams',
  'score-sheet',
]

let client: QueryClient
const renderForm = (props: Partial<React.ComponentProps<typeof StudentForm>> = {}) => {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <StudentForm cls={cls} roster={roster} onClose={onClose} {...props} />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: DEFAULT_TAG_POOL })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

it('suggests the next student number keeping prefix and width', () => {
  expect(
    nextStudentNo([{ student_no: '2026009' }, { student_no: '2026010' }] as StudentSeat[]),
  ).toBe('2026011')
  expect(nextStudentNo([{ student_no: '9' }, { student_no: '10' }] as StudentSeat[])).toBe('11')
  expect(nextStudentNo([{ student_no: 'S007' }] as StudentSeat[])).toBe('S008')
  expect(
    nextStudentNo([
      { student_no: null },
      { student_no: '' },
      { student_no: '甲' },
    ] as StudentSeat[]),
  ).toBe('')
  expect(nextStudentNo([])).toBe('')
})

it('adds a student with contacts, invalidates queries and closes', async () => {
  vi.mocked(studentsApi.create).mockResolvedValue(rec({ enrollment_id: 'e9' }))
  const spy = vi.spyOn(client, 'invalidateQueries')
  const onClose = renderForm()
  expect(screen.getByLabelText('学号')).toHaveValue('2026011')
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: ' 赵六 ' } })
  fireEvent.change(screen.getByLabelText('性别'), { target: { value: '女' } })
  fireEvent.change(screen.getByLabelText('座位'), { target: { value: '2-2' } })
  fireEvent.click(screen.getByRole('button', { name: '重点关注' }))
  fireEvent.change(screen.getByLabelText('联系人1姓名'), { target: { value: '赵母' } })
  fireEvent.change(screen.getByLabelText('联系人1关系'), { target: { value: '母亲' } })
  fireEvent.change(screen.getByLabelText('联系人1电话'), { target: { value: '13800000006' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(studentsApi.create).toHaveBeenCalledWith(
    'c1',
    expect.objectContaining({
      name: '赵六',
      gender: '女',
      student_no: '2026011',
      seat: { row: 2, col: 2 },
      tags: ['重点关注'],
      boarding: false,
      contacts: [{ name: '赵母', relation: '母亲', phone: '13800000006', job: '' }],
    }),
  )
  for (const k of ROSTER_KEYS) {
    expect(spy).toHaveBeenCalledWith({ queryKey: [k] })
  }
})

it('names every form control by its visible label', () => {
  renderForm()
  expect(screen.getByRole('combobox', { name: '性别' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '家庭结构' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '座位' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '住校' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '保存后继续添加' })).toBeInTheDocument()
})

it('marks the invalid name, links its error and focuses it on submit', async () => {
  renderForm()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  const name = await screen.findByRole('textbox', { name: '姓名' })
  await waitFor(() => expect(name).toHaveFocus())
  expect(name).toHaveAttribute('aria-invalid', 'true')
  expect(name).toHaveAccessibleDescription('请填写姓名')
  expect(screen.getByRole('textbox', { name: '学号' })).not.toHaveAttribute('aria-invalid')
})

it('keeps the form open with the next number when asked to continue', async () => {
  vi.mocked(studentsApi.create).mockResolvedValue(
    rec({ enrollment_id: 'e9', student_no: '2026011' }),
  )
  const onClose = renderForm()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.click(screen.getByLabelText('保存后继续添加'))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByLabelText('姓名')).toHaveValue(''))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('学号')).toHaveValue('2026012')
  expect(screen.getByLabelText('保存后继续添加')).toBeChecked()
})

it('requires a name and a contact name or phone', async () => {
  renderForm()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('请填写姓名')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.change(screen.getByLabelText('联系人1关系'), { target: { value: '母亲' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('联系人姓名和电话至少填一项')).toBeInTheDocument()
  expect(studentsApi.create).not.toHaveBeenCalled()
})

it('marks occupied and locked seats in the seat select', () => {
  renderForm()
  const seat = screen.getByLabelText('座位')
  const opt = (n: string) => within(seat).getByRole('option', { name: n }) as HTMLOptionElement
  expect(opt('不排座').value).toBe('')
  expect(opt('1排1列 (原座位同学将挪到空位)')).not.toBeDisabled()
  expect(opt('1排2列 (已固定)')).toBeDisabled()
  expect(opt('2排2列')).toBeInTheDocument()
  expect(within(seat).getAllByRole('option')).toHaveLength(5)
})

it('marks occupied seats as swapping when editing, not the own seat', () => {
  renderForm({ record: roster[0] })
  const seat = screen.getByLabelText('座位')
  expect(seat).toHaveValue('1-1')
  expect(within(seat).getByRole('option', { name: '1排1列' })).toBeInTheDocument()
  expect(within(seat).getByRole('option', { name: '2排1列 (将互换)' })).not.toBeDisabled()
})

it('shows the duplicate number error under the field', async () => {
  vi.mocked(studentsApi.create).mockRejectedValue(new ApiError(409, 'DUPLICATE_STUDENT_NO', 'dup'))
  const onClose = renderForm()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('这个学号已经有人用了')).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
})

it('shows the seat locked error and other errors', async () => {
  vi.mocked(studentsApi.create).mockRejectedValueOnce(new ApiError(409, 'SEAT_LOCKED', 'x'))
  renderForm()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('该座位的同学已固定,不能互换')).toBeInTheDocument()
  vi.mocked(studentsApi.create).mockRejectedValueOnce(
    new ApiError(409, 'NO_ACTIVE_YEAR', '学校还没有进行中的学年'),
  )
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('学校还没有进行中的学年')
})

it('prefills when editing and sends update with the changes', async () => {
  vi.mocked(studentsApi.update).mockResolvedValue(rec({ enrollment_id: 'e3' }))
  const onClose = renderForm({ record: roster[2] })
  expect(screen.queryByLabelText('保存后继续添加')).toBeNull()
  expect(screen.getByLabelText('姓名')).toHaveValue('王五')
  expect(screen.getByLabelText('学号')).toHaveValue('2026003')
  expect(screen.getByLabelText('联系人1姓名')).toHaveValue('王父')
  expect(screen.getByRole('button', { name: '爱画画' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '王小五' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(studentsApi.update).toHaveBeenCalledWith(
    'c1',
    'e3',
    expect.objectContaining({
      name: '王小五',
      seat: { row: 2, col: 1 },
      tags: ['爱画画', '近视'],
    }),
  )
})

it('adds custom tags with Enter but not while composing', () => {
  renderForm()
  const input = screen.getByLabelText('自定义标签')
  fireEvent.change(input, { target: { value: '爱读书' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(screen.queryByRole('button', { name: '爱读书' })).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: '爱读书' })).toHaveAttribute('aria-pressed', 'true')
  expect(input).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '爱读书' }))
  expect(screen.getByRole('button', { name: '爱读书' })).toHaveAttribute('aria-pressed', 'false')
})

it('ignores the post-composition Enter that Safari reports with keyCode 229', () => {
  renderForm()
  const input = screen.getByLabelText('自定义标签')
  fireEvent.change(input, { target: { value: '爱读书' } })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(screen.queryByRole('button', { name: '爱读书' })).toBeNull()
})

it('keeps boarding and the 住校 tag in sync', () => {
  renderForm()
  const boarding = screen.getByLabelText('住校')
  const tag = screen.getByRole('button', { name: '住校' })
  fireEvent.click(boarding)
  expect(tag).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(tag)
  expect(boarding).not.toBeChecked()
  fireEvent.click(tag)
  expect(boarding).toBeChecked()
})

it('deletes after confirmation', async () => {
  vi.mocked(studentsApi.remove).mockResolvedValue(undefined)
  const spy = vi.spyOn(client, 'invalidateQueries')
  const onClose = renderForm({ record: roster[0] })
  expect(screen.queryByRole('button', { name: '删除学生' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '删除学生' }))
  expect(
    screen.getByText('删除张三?删除后该学生不再出现在名单、教室和成绩里。'),
  ).toBeInTheDocument()
  expect(studentsApi.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(studentsApi.remove).toHaveBeenCalledWith('c1', 'e1')
  for (const k of ROSTER_KEYS) expect(spy).toHaveBeenCalledWith({ queryKey: [k] })
})

it('does not show delete when adding', () => {
  renderForm()
  expect(screen.queryByRole('button', { name: '删除学生' })).toBeNull()
})

const podiumCls: ClassView = { ...cls, podium_left: 2, podium_right: 1 }
const fullAuto: ClassView = { ...cls, seat_layout: 'auto' }
const fullRoster = [
  rec({ enrollment_id: 'f1', name: '甲', seat_row: 1, seat_col: 1 }),
  rec({ enrollment_id: 'f2', name: '乙', seat_row: 1, seat_col: 2 }),
  rec({ enrollment_id: 'f3', name: '丙', seat_row: 2, seat_col: 1 }),
  rec({ enrollment_id: 'f4', name: '丁', seat_row: 2, seat_col: 2 }),
]

it('lists podium seats with their names', async () => {
  vi.mocked(studentsApi.create).mockResolvedValue(rec({ enrollment_id: 'e9' }))
  const onClose = renderForm({ cls: podiumCls })
  const labels = within(screen.getByLabelText('座位'))
    .getAllByRole('option')
    .map((o) => o.textContent)
  expect(labels.slice(0, 4)).toEqual([
    '不排座',
    '讲台左边（靠讲桌）',
    '讲台左边（外侧）',
    '讲台右边',
  ])
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.change(screen.getByLabelText('座位'), { target: { value: '0--2' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(studentsApi.create).toHaveBeenCalledWith(
    'c1',
    expect.objectContaining({ seat: { row: 0, col: -2 } }),
  )
})

it('defaults to auto seat when an auto class is full', async () => {
  vi.mocked(studentsApi.create).mockResolvedValue(rec({ enrollment_id: 'e9' }))
  const onClose = renderForm({ cls: fullAuto, roster: fullRoster })
  const select = screen.getByLabelText('座位') as HTMLSelectElement
  expect(within(select).getAllByRole('option')[0]).toHaveTextContent('自动加座位')
  expect(select.selectedOptions[0]).toHaveTextContent('自动加座位')
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const body = vi.mocked(studentsApi.create).mock.calls[0][1]
  expect(body.seat).toBeNull()
  expect(body.auto_seat).toBe(true)
})

it('does not offer auto seat when editing or for manual classes', () => {
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <StudentForm cls={fullAuto} record={fullRoster[0]} roster={fullRoster} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole('option', { name: '自动加座位' })).toBeNull()
  unmount()
  renderForm({ cls: { ...cls, seat_layout: 'manual' }, roster: fullRoster })
  expect(screen.queryByRole('option', { name: '自动加座位' })).toBeNull()
})

it('does not offer auto seat while an auto class still has an empty seat', () => {
  renderForm({ cls: fullAuto, roster: fullRoster.slice(0, 3) })
  expect(screen.queryByRole('option', { name: '自动加座位' })).toBeNull()
})

it('also invalidates my-classes after adding so the classroom map sees new seats', async () => {
  vi.mocked(studentsApi.create).mockResolvedValue(rec({ enrollment_id: 'e9' }))
  const spy = vi.spyOn(client, 'invalidateQueries')
  renderForm()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '赵六' } })
  fireEvent.change(screen.getByLabelText('联系人1姓名'), { target: { value: '赵父' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['my-classes'] }))
})

const tagChips = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('aria-pressed'))
    .map((b) => b.textContent)

it('offers the school tag pool from the API', async () => {
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: ['重点关注', '住校', '自定义A'] })
  renderForm()
  await waitFor(() => expect(tagChips()).toEqual(['重点关注', '住校', '自定义A']))
})

it('falls back to the default pool while loading and when loading fails', async () => {
  vi.mocked(schoolApi.tagPool).mockRejectedValue(new ApiError(500, 'X', '失败'))
  renderForm()
  expect(tagChips()).toEqual(DEFAULT_TAG_POOL)
  await waitFor(() => expect(schoolApi.tagPool).toHaveBeenCalled())
  expect(tagChips()).toEqual(DEFAULT_TAG_POOL)
})

it('keeps a student tag that is no longer in the pool as a chip', async () => {
  vi.mocked(schoolApi.tagPool).mockResolvedValue({ tags: ['重点关注', '住校'] })
  renderForm({ record: rec({ enrollment_id: 'e3', tags: ['近视'] }) })
  await waitFor(() => expect(tagChips()).toEqual(['重点关注', '住校', '近视']))
})
