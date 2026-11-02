import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { downloadText } from '@/shared/lib/csv'
import { STUDENT_TEMPLATE_CSV } from '@/shared/lib/columns'
import type { ClassView } from '@/shared/types/class'
import ImportDialog from './ImportDialog'

vi.mock('@/shared/api/students', () => ({ studentsApi: { importRows: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/shared/lib/csv')>()), downloadText: vi.fn() }))

const cls: ClassView = { id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 2, seat_cols: 2, role: 'homeroom_teacher' }
const PASTED = '姓名\t性别\t学号\n张三\t男\t01\n李四\t女\t02\n'

let client: QueryClient
const renderDialog = () => {
  const onClose = vi.fn()
  render(<QueryClientProvider client={client}><ImportDialog cls={cls} onClose={onClose} /></QueryClientProvider>)
  return onClose
}
const paste = (text: string) => fireEvent.change(screen.getByLabelText('粘贴名单'), { target: { value: text } })

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

it('previews and imports pasted rows with auto seating', async () => {
  vi.mocked(studentsApi.importRows).mockResolvedValue({ created: 1, skipped: [{ index: 1, reason: 'duplicate' }] })
  const spy = vi.spyOn(client, 'invalidateQueries')
  const onClose = renderDialog()
  expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
  paste(PASTED)
  expect(screen.getByText('识别到 2 人,3 列')).toBeInTheDocument()
  expect(screen.getByLabelText('自动安排到空座位')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '导入' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const [id, body] = vi.mocked(studentsApi.importRows).mock.calls[0]
  expect(id).toBe('c1')
  expect(body.auto_seat).toBe(true)
  expect(body.rows.map((r) => r.name)).toEqual(['张三', '李四'])
  expect(toast).toHaveBeenCalledWith('导入 1 人,跳过重复 1 人')
  for (const k of ['student-records', 'class-students', 'classroom', 'gradebook', 'student', 'exams', 'score-sheet']) {
    expect(spy).toHaveBeenCalledWith({ queryKey: [k] })
  }
  expect(screen.getByRole('checkbox', { name: '自动安排到空座位' })).toBeInTheDocument()
})

it('sends auto_seat false when unchecked', async () => {
  vi.mocked(studentsApi.importRows).mockResolvedValue({ created: 2, skipped: [] })
  renderDialog()
  paste(PASTED)
  fireEvent.click(screen.getByLabelText('自动安排到空座位'))
  fireEvent.click(screen.getByRole('button', { name: '导入' }))
  await waitFor(() => expect(studentsApi.importRows).toHaveBeenCalled())
  expect(vi.mocked(studentsApi.importRows).mock.calls[0][1].auto_seat).toBe(false)
})

it('asks for a name column', () => {
  renderDialog()
  paste('学号\n01\n')
  expect(screen.getByText('第一行要有"姓名"列')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
})

it('asks to split batches over 200 students', () => {
  renderDialog()
  paste('姓名\n' + Array.from({ length: 201 }, (_, i) => `学生${i}`).join('\n'))
  expect(screen.getByText('识别到 201 人,1 列')).toBeInTheDocument()
  expect(screen.getByText('一次最多导入 200 人,请分批导入')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
})

it('reads a chosen CSV file', async () => {
  renderDialog()
  const file = new File(['\uFEFF' + PASTED.replace(/\t/g, ',')], 'a.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), { target: { files: [file] } })
  expect(await screen.findByText('识别到 2 人,3 列')).toBeInTheDocument()
})

it('downloads the template with a BOM', () => {
  renderDialog()
  fireEvent.click(screen.getByRole('button', { name: '下载模板' }))
  const [name, text] = vi.mocked(downloadText).mock.calls[0]
  expect(name).toBe('学生名单模板.csv')
  expect(text.startsWith('﻿')).toBe(true)
  expect(text.slice(1)).toBe(STUDENT_TEMPLATE_CSV)
})

it('shows the error and stays open when the import fails', async () => {
  vi.mocked(studentsApi.importRows).mockRejectedValue(new ApiError(409, 'NO_ACTIVE_YEAR', '学校还没有进行中的学年'))
  const onClose = renderDialog()
  paste(PASTED)
  fireEvent.click(screen.getByRole('button', { name: '导入' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('学校还没有进行中的学年')
  expect(onClose).not.toHaveBeenCalled()
})

it('clears a stale error when the text, file or auto-seat option changes', async () => {
  vi.mocked(studentsApi.importRows).mockRejectedValue(new ApiError(409, 'NO_ACTIVE_YEAR', '学校还没有进行中的学年'))
  renderDialog()
  const fail = async () => {
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  }
  paste(PASTED)
  await fail()
  paste(PASTED + '王五\t男\t03\n')
  expect(screen.queryByRole('alert')).toBeNull()
  await fail()
  fireEvent.click(screen.getByLabelText('自动安排到空座位'))
  expect(screen.queryByRole('alert')).toBeNull()
  await fail()
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), { target: { files: [new File([PASTED], 'a.csv')] } })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
