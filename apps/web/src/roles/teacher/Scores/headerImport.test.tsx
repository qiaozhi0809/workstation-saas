import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { Exam } from '@/shared/types/grades'
import { ALL_PERMS, classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import HeaderImport from './HeaderImport'
import ScoresPage from './ScoresPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const EXAM: Exam = {
  id: 'x1', name: '十月月考', exam_type: '月考', date: '2026-10-20',
  subjects: [{ name: '语文', full: 100 }, { name: '数学', full: 100 }],
  created_by_me: true, progress: { entered: 0, total: 3 },
}

function renderImport(writable: string[] | null = null) {
  const onClose = vi.fn()
  const onImported = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <HeaderImport classId="c1" exam={EXAM} roster={rosterFixture} writable={writable}
        onClose={onClose} onImported={onImported} />
    </QueryClientProvider>,
  )
  return { onClose, onImported, invalidate }
}
const paste = (text: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
const importBtn = () => screen.getByRole('button', { name: '导入' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(examsApi.saveScores).mockResolvedValue({ updated: 1 })
})

it('previews matches and imports only matched rows', async () => {
  const { onImported, invalidate } = renderImport()
  paste('姓名,语文\n王小一,90\n不存在,80')
  expect(screen.getByText('识别到 2 行,匹配 1 人;科目:语文')).toBeInTheDocument()
  fireEvent.click(importBtn())
  await waitFor(() => expect(onImported).toHaveBeenCalled())
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [{ enrollment_id: 'e1', subject: '语文', value: 90 }])
  expect(toast).toHaveBeenCalledWith('已导入 1 格,1 行没对上名字')
  const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)
  expect(keys).toEqual(expect.arrayContaining([['score-sheet', 'c1', 'x1'], ['exams', 'c1'], ['gradebook', 'c1']]))
})

it('matches by student number first and skips empty cells, maps absent', async () => {
  renderImport()
  paste('学号,姓名,语文,数学\n2026002,谁,缺考,\n2026001,,,70')
  fireEvent.click(importBtn())
  await waitFor(() => expect(examsApi.saveScores).toHaveBeenCalled())
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [
    { enrollment_id: 'e2', subject: '语文', value: 'absent' },
    { enrollment_id: 'e1', subject: '数学', value: 70 },
  ])
})

it('counts invalid and over-full cells without writing them', async () => {
  renderImport()
  paste('姓名,语文,数学\n王小一,101,abc\n李小二,88,')
  fireEvent.click(importBtn())
  await waitFor(() => expect(toast).toHaveBeenCalled())
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [{ enrollment_id: 'e2', subject: '语文', value: 88 }])
  expect(toast).toHaveBeenCalledWith('已导入 1 格,2 格超出满分或格式不对,未导入')
})

it('ignores subjects that are not writable', async () => {
  renderImport(['数学'])
  paste('姓名,语文,数学\n王小一,90,80')
  expect(screen.getByText('识别到 1 行,匹配 1 人;科目:数学')).toBeInTheDocument()
  fireEvent.click(importBtn())
  await waitFor(() => expect(examsApi.saveScores).toHaveBeenCalled())
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [{ enrollment_id: 'e1', subject: '数学', value: 80 }])
})

it('asks for a name or number column', () => {
  renderImport()
  paste('语文,数学\n90,80')
  expect(screen.getByText('第一行要有"姓名"或"学号"')).toBeInTheDocument()
  expect(importBtn()).toBeDisabled()
})

it('reads a csv file into the textarea, stripping the BOM', async () => {
  renderImport()
  const file = new File(['﻿姓名,语文\n王小一,90'], 'a.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText('识别到 1 行,匹配 1 人;科目:语文')).toBeInTheDocument())
})

it('keeps the modal open and shows the error when saving fails', async () => {
  vi.mocked(examsApi.saveScores).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '没有这个科目的录入权限'))
  const { onImported, onClose } = renderImport()
  paste('姓名,语文\n王小一,90')
  fireEvent.click(importBtn())
  expect(await screen.findByRole('alert')).toHaveTextContent('没有这个科目的录入权限')
  expect(onImported).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('sends large imports in chunks of at most 2000 cells', async () => {
  renderImport()
  const rows = Array.from({ length: 1100 }, () => '王小一,90,80').join('\n')
  paste(`姓名,语文,数学\n${rows}`)
  fireEvent.click(importBtn())
  await waitFor(() => expect(examsApi.saveScores).toHaveBeenCalledTimes(2))
  const sizes = vi.mocked(examsApi.saveScores).mock.calls.map((c) => c[2].length)
  expect(sizes).toEqual([2000, 200])
})

function setupPage(perms: string[]) {
  useTeacherStore.setState({ classId: 'c1' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({
    my_perms: [...ALL_PERMS, 'exam.read', ...perms] as never, my_subjects: [],
  }))
  vi.mocked(examsApi.list).mockResolvedValue({ items: [EXAM] })
  vi.mocked(examsApi.sheet).mockResolvedValue({ exam: EXAM, items: [] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/teacher/scores', element: <ScoresPage /> }], { initialEntries: ['/teacher/scores'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

it('hides export without score.export and shows header buttons by permission', async () => {
  setupPage(['score.write'])
  expect(await screen.findByRole('button', { name: '按表头导入' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '导出' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '看分析' })).toHaveAttribute('href', '/teacher/analysis?exam=x1')
})

it('shows export with score.export and hides import without score.write', async () => {
  setupPage(['score.export'])
  expect(await screen.findByRole('button', { name: '导出' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '按表头导入' })).not.toBeInTheDocument()
})
