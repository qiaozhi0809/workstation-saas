import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import type { ClassView } from '@/shared/types/class'
import type { LayoutPreview } from '@/shared/types/seating'
import ClassSettingsDialog, { type ClassSettingsDialogProps } from './ClassSettingsDialog'

vi.mock('@/shared/api/seating', () => ({ seatingApi: { preview: vi.fn(), saveLayout: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const cls: ClassView = {
  id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 2, seat_cols: 4, desk_size: 2,
  seat_layout: 'manual', seat_order: 'row', podium_left: 0, podium_right: 0, room: '', role: 'homeroom_teacher',
}
const PREVIEW: LayoutPreview = { rows: 2, cols: 4, seats: [], capacity: 8, students: 8, unseated: 0 }

let client: QueryClient
const renderDialog = (over: Partial<ClassSettingsDialogProps> = {}) => {
  const props: ClassSettingsDialogProps = {
    cls, seatVersion: 7, studentCount: 8, hasSeated: true,
    onClose: vi.fn(), onSaved: vi.fn(), onGo: vi.fn(), ...over,
  }
  render(<QueryClientProvider client={client}><ClassSettingsDialog {...props} /></QueryClientProvider>)
  return props
}
const lastPreview = () => vi.mocked(seatingApi.preview).mock.calls.at(-1)![1]

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(seatingApi.preview).mockResolvedValue(PREVIEW)
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: [] } as never)
})

it('shows the class name read-only and edits the room', async () => {
  renderDialog()
  expect(screen.getByText('班级设置 · 三年二班')).toBeInTheDocument()
  expect(screen.getByText('班级名称由学校统一管理')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '班级名称' })).toBeNull()
  const room = screen.getByRole('textbox', { name: '教室' })
  expect(room).toHaveAttribute('maxlength', '30')
  expect(room).toHaveAttribute('placeholder', '如:博学楼 301')
  fireEvent.change(room, { target: { value: '博学楼 301' } })
  expect(room).toHaveValue('博学楼 301')
  await waitFor(() => expect(seatingApi.preview).toHaveBeenCalled())
})

it('previews with the default how and sends drafts as controls change', async () => {
  renderDialog()
  expect(screen.getByRole('button', { name: '保持现在的座位' })).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(seatingApi.preview).toHaveBeenCalledTimes(1))
  expect(vi.mocked(seatingApi.preview).mock.calls[0][0]).toBe('c1')
  expect(lastPreview()).toMatchObject({ how: 'keep', desk_size: 2, cols: 4 })
  fireEvent.click(screen.getByRole('tab', { name: '三人一排' }))
  await waitFor(() => expect(lastPreview()).toMatchObject({ desk_size: 3, cols: 3 }))
})

it('defaults how to the class seat order when nobody is seated', async () => {
  renderDialog({ hasSeated: false, cls: { ...cls, seat_order: 'col' } })
  expect(screen.getByRole('button', { name: '按学号一组一组竖着排' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('竖着排:先坐满第一组,从前往后,再坐下一组')).toBeInTheDocument()
  await waitFor(() => expect(lastPreview().how).toBe('col'))
})

it('shows steppers only for manual and clamps them', async () => {
  renderDialog({ cls: { ...cls, seat_layout: 'auto' } })
  expect(screen.queryByRole('group', { name: '排数' })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '自己设定' }))
  expect(screen.getByRole('group', { name: '排数' })).toBeInTheDocument()
  const plus = screen.getByRole('button', { name: '排数增加' })
  for (let i = 0; i < 12; i++) if (!(plus as HTMLButtonElement).disabled) fireEvent.click(plus)
  expect(plus).toBeDisabled()
  await waitFor(() => expect(lastPreview()).toMatchObject({ seat_layout: 'manual', rows: 12 }))
})

it('warns when seats are fewer than students', async () => {
  vi.mocked(seatingApi.preview).mockResolvedValue({ ...PREVIEW, capacity: 4, students: 10, unseated: 6 })
  renderDialog()
  expect(await screen.findByText('座位比学生少 6 个,坐不下的同学会显示为「未排座」')).toBeInTheDocument()
  expect(screen.getByText('2 排 × 4 个座位 = 4 个座位 · 学生 10 人')).toBeInTheDocument()
})

it('shows the unseated hint and keeps the last preview on error', async () => {
  vi.mocked(seatingApi.preview).mockResolvedValueOnce({ ...PREVIEW, capacity: 10, students: 8, unseated: 2 })
  renderDialog()
  expect(await screen.findByText('2 人未排座,可以在「排座」模式里拖到空位')).toBeInTheDocument()
  vi.mocked(seatingApi.preview).mockRejectedValue(new Error('x'))
  fireEvent.click(screen.getByRole('button', { name: '按学号横着排' }))
  expect(await screen.findByText('预览加载失败')).toBeInTheDocument()
  expect(screen.getByText('2 人未排座,可以在「排座」模式里拖到空位')).toBeInTheDocument()
})

it('saves with base version and room, then reports moved', async () => {
  const saved = { version: 8, moved: true, rows: 2, cols: 4 }
  vi.mocked(seatingApi.saveLayout).mockResolvedValue(saved)
  const p = renderDialog()
  fireEvent.change(screen.getByRole('textbox', { name: '教室' }), { target: { value: '博学楼 301' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(p.onClose).toHaveBeenCalled())
  expect(seatingApi.saveLayout).toHaveBeenCalledTimes(1)
  expect(vi.mocked(seatingApi.saveLayout).mock.calls[0][1]).toMatchObject({ base_version: 7, room: '博学楼 301', how: 'keep' })
  expect(toast).toHaveBeenCalledWith('已保存,座位已按新桌椅排好')
  expect(p.onSaved).toHaveBeenCalledWith(saved)
})

it('keeps the dialog open on a version conflict', async () => {
  vi.mocked(seatingApi.saveLayout).mockRejectedValue(new ApiError(409, 'CONFLICT', 'conflict'))
  const p = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('座位表已被其他人修改,请关闭后重新打开'))
  expect(p.onClose).not.toHaveBeenCalled()
  expect(p.onSaved).not.toHaveBeenCalled()
})

it('saves before going to add students', async () => {
  vi.mocked(seatingApi.saveLayout).mockResolvedValue({ version: 8, moved: false, rows: 2, cols: 4 })
  const p = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '添加学生' }))
  await waitFor(() => expect(p.onGo).toHaveBeenCalledWith('add'))
  expect(seatingApi.saveLayout).toHaveBeenCalledTimes(1)
  expect(toast).toHaveBeenCalledWith('已保存')
  expect(p.onClose).toHaveBeenCalled()
})

it('normalizes cols to the desk size when switching to manual before the preview catches up', async () => {
  renderDialog({ cls: { ...cls, seat_layout: 'auto' } })
  await waitFor(() => expect(seatingApi.preview).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('tab', { name: '三人一排' }))
  fireEvent.click(screen.getByRole('tab', { name: '自己设定' }))
  await waitFor(() => expect(lastPreview()).toMatchObject({ seat_layout: 'manual', desk_size: 3 }))
  const cols = lastPreview().cols as number
  expect(cols % 3).toBe(0)
  expect(cols).toBeGreaterThanOrEqual(3)
})

it('clears cols when the desk changes under auto and keeps the draft cols when switching back to auto', async () => {
  renderDialog({ cls: { ...cls, seat_layout: 'auto' } })
  fireEvent.click(screen.getByRole('tab', { name: '三人一排' }))
  await waitFor(() => expect(lastPreview()).toMatchObject({ seat_layout: 'auto', desk_size: 3, cols: null }))
  vi.mocked(seatingApi.preview).mockResolvedValue({ ...PREVIEW, cols: 9 })
  fireEvent.click(screen.getByRole('tab', { name: '自己设定' }))
  await waitFor(() => expect(lastPreview()).toMatchObject({ seat_layout: 'manual' }))
  const manualCols = lastPreview().cols
  fireEvent.click(screen.getByRole('button', { name: '每排增加' }))
  fireEvent.click(screen.getByRole('button', { name: '每排减少' }))
  fireEvent.click(screen.getByRole('tab', { name: '按人数自动排' }))
  await waitFor(() => expect(lastPreview()).toMatchObject({ seat_layout: 'auto', cols: manualCols }))
})

it('shows the preview text from the same settled draft as the preview map', async () => {
  renderDialog()
  expect(await screen.findByText('2 排 × 4 个座位 = 8 个座位 · 学生 8 人')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '左边增加' }))
  expect(screen.getByText('2 排 × 4 个座位 = 8 个座位 · 学生 8 人')).toBeInTheDocument()
  expect(await screen.findByText('2 排 × 4 个座位 + 讲台边 1 个 = 8 个座位 · 学生 8 人')).toBeInTheDocument()
})

it('blocks cancel and closing while saving', async () => {
  let release!: (v: unknown) => void
  vi.mocked(seatingApi.saveLayout).mockReturnValue(new Promise((r) => { release = r }) as never)
  const p = renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toBeDisabled())
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(p.onClose).not.toHaveBeenCalled()
  release({ version: 8, moved: false, rows: 2, cols: 4 })
  await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1))
})
