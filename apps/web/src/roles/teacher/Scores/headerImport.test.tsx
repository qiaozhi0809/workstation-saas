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
import { classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'
import HeaderImport from './HeaderImport'
import ScoresPage from './ScoresPage'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/students', () => ({ studentsApi: { listInClass: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
// 及格 / 优秀比例固定为默认值,不依赖 /school/grading 的真实请求失败后回退
vi.mock('@/shared/hooks/useGrading', async () => {
  const { DEFAULT_GRADING } = await import('@/shared/lib/grades')
  return { useGrading: () => DEFAULT_GRADING }
})

const EXAM: Exam = {
  id: 'x1',
  name: '十月月考',
  exam_type: '月考',
  date: '2026-10-20',
  subjects: [
    { name: '语文', full: 100 },
    { name: '数学', full: 100 },
  ],
  grade_exam_id: null,
  created_by_me: true,
  progress: { entered: 0, total: 3 },
}

function renderImport(writable: string[] | null = null, roster = rosterFixture) {
  const onClose = vi.fn()
  const onImported = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <HeaderImport
        classId="c1"
        exam={EXAM}
        roster={roster}
        writable={writable}
        onClose={onClose}
        onImported={onImported}
      />
    </QueryClientProvider>,
  )
  return { onClose, onImported, invalidate }
}
const paste = (text: string) =>
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
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
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [
    { enrollment_id: 'e1', subject: '语文', value: 90 },
  ])
  expect(toast).toHaveBeenCalledWith('已导入 1 格,1 行没对上名字')
  const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)
  expect(keys).toEqual(
    expect.arrayContaining([
      ['score-sheet', 'c1', 'x1'],
      ['exams', 'c1'],
      ['gradebook', 'c1'],
    ]),
  )
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
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [
    { enrollment_id: 'e2', subject: '语文', value: 88 },
  ])
  expect(toast).toHaveBeenCalledWith('已导入 1 格,2 格超出满分或格式不对,未导入')
})

it('ignores subjects that are not writable', async () => {
  renderImport(['数学'])
  paste('姓名,语文,数学\n王小一,90,80')
  expect(screen.getByText('识别到 1 行,匹配 1 人;科目:数学')).toBeInTheDocument()
  fireEvent.click(importBtn())
  await waitFor(() => expect(examsApi.saveScores).toHaveBeenCalled())
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [
    { enrollment_id: 'e1', subject: '数学', value: 80 },
  ])
})

it('explains why nothing can be imported', () => {
  renderImport()
  paste('姓名,语文\n王小一,abc\n李小二,101\n不存在,80')
  expect(screen.getByText('识别到 3 行,匹配 2 人;科目:语文')).toBeInTheDocument()
  expect(screen.getByText(',1 行没对上名字')).toBeInTheDocument()
  expect(screen.getByText(',2 格超出满分或格式不对')).toBeInTheDocument()
  expect(screen.getByText('没有可导入的分数')).toBeInTheDocument()
  expect(importBtn()).toBeDisabled()
})

it('counts a repeated student/subject once, later row winning', async () => {
  renderImport()
  paste('姓名,语文\n王小一,60\n王小一,70')
  fireEvent.click(importBtn())
  await waitFor(() => expect(toast).toHaveBeenCalledWith('已导入 1 格'))
  expect(examsApi.saveScores).toHaveBeenCalledWith('c1', 'x1', [
    { enrollment_id: 'e1', subject: '语文', value: 70 },
  ])
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
  await waitFor(() =>
    expect(screen.getByText('识别到 1 行,匹配 1 人;科目:语文')).toBeInTheDocument(),
  )
})

// "姓名,语文\n王小一,90" 的 GBK 字节(Excel 另存的 CSV 常见编码);按 UTF-8 读会出现替换字符
const GBK_CSV = new Uint8Array([
  0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xd3, 0xef, 0xce, 0xc4, 0x0a, 0xcd, 0xf5, 0xd0, 0xa1, 0xd2, 0xbb,
  0x2c, 0x39, 0x30,
])
const pickFile = (bytes: BlobPart) =>
  fireEvent.change(screen.getByLabelText('选择 CSV 文件'), {
    target: { files: [new File([bytes], 'a.csv', { type: 'text/csv' })] },
  })

it('re-reads a csv file as GBK when it is not valid UTF-8 (L15)', async () => {
  renderImport()
  pickFile(GBK_CSV)
  await waitFor(() =>
    expect(screen.getByText('识别到 1 行,匹配 1 人;科目:语文')).toBeInTheDocument(),
  )
  expect(screen.getByRole('textbox')).toHaveValue('姓名,语文\n王小一,90')
})

it('keeps the UTF-8 reading and explains when the browser cannot decode GBK (L15)', async () => {
  const Real = globalThis.TextDecoder
  vi.stubGlobal(
    'TextDecoder',
    class extends Real {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label === 'gbk') throw new RangeError('unsupported encoding')
        super(label, options)
      }
    },
  )
  try {
    renderImport()
    pickFile(GBK_CSV)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '文件不是 UTF-8 编码,这个浏览器不能按 GBK 读取,请在 Excel 里另存为 UTF-8 的 CSV 后再试',
    )
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('\uFFFD')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('points at the row and subject the server rejected (L15)', async () => {
  vi.mocked(examsApi.saveScores).mockRejectedValue(
    new ApiError(400, 'SCORE_INVALID', '分数不合法', { enrollment_id: 'e2', subject: '数学' }),
  )
  renderImport()
  paste('姓名,语文,数学\n王小一,90,80\n李小二,88,77')
  fireEvent.click(importBtn())
  expect(await screen.findByRole('alert')).toHaveTextContent('第 2 行 · 数学(李小二):分数不合法')
})

it('keeps the modal open and shows the error when saving fails', async () => {
  vi.mocked(examsApi.saveScores).mockRejectedValue(
    new ApiError(403, 'FORBIDDEN', '没有这个科目的录入权限'),
  )
  const { onImported, onClose } = renderImport()
  paste('姓名,语文\n王小一,90')
  fireEvent.click(importBtn())
  expect(await screen.findByRole('alert')).toHaveTextContent('没有这个科目的录入权限')
  expect(onImported).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('sends large imports in chunks of at most 2000 cells', async () => {
  const many = Array.from({ length: 1100 }, (_, i) => ({
    ...rosterFixture[0],
    enrollment_id: `m${i}`,
    student_no: `N${i}`,
    name: `学生${i}`,
  }))
  renderImport(null, many)
  const rows = many.map((m) => `${m.name},90,80`).join('\n')
  paste(`姓名,语文,数学\n${rows}`)
  fireEvent.click(importBtn())
  await waitFor(() => expect(examsApi.saveScores).toHaveBeenCalledTimes(2))
  const sizes = vi.mocked(examsApi.saveScores).mock.calls.map((c) => c[2].length)
  expect(sizes).toEqual([2000, 200])
})

function setupPage(perms: string[]) {
  useTeacherStore.setState({ classId: 'c1' })
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })
  vi.mocked(classroomApi.summary).mockResolvedValue(
    summaryFixture({
      my_perms: ['exam.read', ...perms] as never,
      my_subjects: [],
    }),
  )
  vi.mocked(examsApi.list).mockResolvedValue({ items: [EXAM] })
  vi.mocked(examsApi.sheet).mockResolvedValue({ exam: EXAM, items: [] })
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/teacher/scores', element: <ScoresPage /> }], {
    initialEntries: ['/teacher/scores'],
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

it('hides export without score.export and shows header buttons by permission', async () => {
  setupPage(['score.write'])
  expect(await screen.findByRole('button', { name: '按表头导入' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '导出' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '看分析' })).toHaveAttribute(
    'href',
    '/teacher/analysis?exam=x1',
  )
})

it('shows export with score.export and hides import without score.write', async () => {
  setupPage(['score.export'])
  expect(await screen.findByRole('button', { name: '导出' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '按表头导入' })).not.toBeInTheDocument()
})
