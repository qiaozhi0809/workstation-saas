import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { Toaster } from '@/shared/components/Toast'
import type { Board } from '@/shared/types/classroom'
import BoardEditor from './BoardEditor'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { saveBoard: vi.fn() } }))

const base: Board = {
  left_title: '今日课程',
  left_text: '',
  right_title: '今日事项',
  right_text: '',
  countdown_label: null,
  countdown_date: null,
}
const onClose = vi.fn()

function renderEditor(board: Board = base) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardEditor classId="c1" board={board} onClose={onClose} />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(classroomApi.saveBoard).mockImplementation(async (_c, b) => b)
})

it('blocks a fifth line and a half-filled countdown, then saves', async () => {
  renderEditor({
    left_title: '今日课程',
    left_text: '',
    right_title: '今日事项',
    right_text: '',
    countdown_label: null,
    countdown_date: null,
  })
  fireEvent.change(screen.getByLabelText('左黑板内容'), { target: { value: '1\n2\n3\n4\n5' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('每块黑板最多 4 行')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('左黑板内容'), { target: { value: '1 语文' } })
  fireEvent.change(screen.getByLabelText('倒计时名称'), { target: { value: '期末考试' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('倒计时名称和日期要一起填')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('倒计时日期'), { target: { value: '2027-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(classroomApi.saveBoard).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        left_text: '1 语文',
        countdown_label: '期末考试',
        countdown_date: '2027-01-15',
      }),
    ),
  )
})

it('invalidates the summary and closes after saving, with empty countdown as null', async () => {
  const { invalidate } = renderEditor()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(classroomApi.saveBoard).toHaveBeenCalledWith('c1', { ...base })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['classroom', 'c1'] })
})

it('blocks empty or too long titles, long text and a long countdown name', async () => {
  renderEditor()
  fireEvent.change(screen.getByLabelText('左黑板标题'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('黑板标题要填 1–10 个字')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('左黑板标题'), { target: { value: '今日课程' } })
  fireEvent.change(screen.getByLabelText('右黑板内容'), { target: { value: '字'.repeat(121) } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('每块黑板最多 120 个字')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('右黑板内容'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('倒计时名称'), { target: { value: '名'.repeat(13) } })
  fireEvent.change(screen.getByLabelText('倒计时日期'), { target: { value: '2027-01-15' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('倒计时名称最多 12 个字')).toBeInTheDocument()
  expect(classroomApi.saveBoard).not.toHaveBeenCalled()
})

it('shows the server error and stays open', async () => {
  vi.mocked(classroomApi.saveBoard).mockRejectedValue(new ApiError(403, 'FORBIDDEN', '没有权限'))
  renderEditor()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('没有权限')).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
})

it('ignores a second submit while saving', async () => {
  let resolve!: (b: Board) => void
  vi.mocked(classroomApi.saveBoard).mockReturnValue(
    new Promise<Board>((r) => {
      resolve = r
    }),
  )
  renderEditor()
  const save = screen.getByRole('button', { name: '保存' })
  fireEvent.click(save)
  fireEvent.click(save)
  expect(classroomApi.saveBoard).toHaveBeenCalledTimes(1)
  resolve(base)
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('closes on Escape and on 取消', () => {
  renderEditor()
  expect(screen.getByRole('dialog', { name: '编辑黑板' })).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

it('stays open on an outside click so typed text is not lost', async () => {
  renderEditor()
  await act(() => new Promise((r) => setTimeout(r, 0)))
  fireEvent.pointerDown(document.body)
  expect(screen.getByRole('dialog', { name: '编辑黑板' })).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
})
