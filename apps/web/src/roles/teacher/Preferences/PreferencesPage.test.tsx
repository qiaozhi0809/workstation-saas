import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { preferencesApi } from '@/shared/api/preferences'
import { Toaster } from '@/shared/components/Toast'
import type { Preferences } from '@/shared/types/preferences'
import PreferencesPage from './PreferencesPage'

vi.mock('@/shared/api/preferences', () => ({ preferencesApi: { get: vi.fn(), save: vi.fn() } }))

const loaded: Preferences = { teacher_figure: 'female', idle_animation: true, review_reasons: [{ text: '积极发言', delta: 1 }] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PreferencesPage /><Toaster /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(preferencesApi.get).mockResolvedValue(loaded)
  vi.mocked(preferencesApi.save).mockImplementation(async (p) => p)
})

it('loads, validates and saves preferences', async () => {
  vi.mocked(preferencesApi.get).mockResolvedValue({ teacher_figure: 'female', idle_animation: true,
    review_reasons: [{ text: '积极发言', delta: 1 }] })
  const { invalidate } = renderPage()
  fireEvent.click(await screen.findByLabelText('男老师'))
  fireEvent.click(screen.getByLabelText('空闲小动画'))
  fireEvent.click(screen.getByRole('button', { name: '添加理由' }))
  const texts = screen.getAllByLabelText('理由'), deltas = screen.getAllByLabelText('分值')
  fireEvent.change(texts[1], { target: { value: '回答问题' } })
  fireEvent.change(deltas[1], { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('分值不能为 0')).toBeInTheDocument()
  fireEvent.change(deltas[1], { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(preferencesApi.save).toHaveBeenCalledWith({ teacher_figure: 'male',
    idle_animation: false, review_reasons: [{ text: '积极发言', delta: 1 }, { text: '回答问题', delta: 2 }] }))
  expect(await screen.findByText('已保存')).toBeInTheDocument()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['preferences'] })
})

it('keeps at least one reason and at most twenty', async () => {
  vi.mocked(preferencesApi.get).mockResolvedValue({ ...loaded,
    review_reasons: Array.from({ length: 19 }, (_, i) => ({ text: `理由${i}`, delta: 1 })) })
  renderPage()
  const add = await screen.findByRole('button', { name: '添加理由' })
  expect(add).toBeEnabled()
  fireEvent.click(add)
  expect(add).toBeDisabled()
  expect(screen.getAllByLabelText('理由')).toHaveLength(20)
  fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])
  expect(screen.getAllByLabelText('理由')).toHaveLength(19)
  expect(add).toBeEnabled()
})

it('disables 删除 when only one reason is left', async () => {
  renderPage()
  expect(await screen.findByRole('button', { name: '删除' })).toBeDisabled()
})

it('validates reason text and range, and does not re-init from a refetch', async () => {
  const { invalidate } = renderPage()
  const text = await screen.findByLabelText('理由')
  fireEvent.change(text, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('理由要填 1–20 个字')).toBeInTheDocument()
  fireEvent.change(text, { target: { value: '字'.repeat(21) } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('理由要填 1–20 个字')).toBeInTheDocument()
  fireEvent.change(text, { target: { value: '改过的' } })
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '11' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('分值要在 -10 到 10 之间')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('分值'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText('分值要在 -10 到 10 之间')).toBeInTheDocument()
  expect(preferencesApi.save).not.toHaveBeenCalled()
  expect(invalidate).not.toHaveBeenCalled()
  expect(screen.getByLabelText('理由')).toHaveValue('改过的')
})

it('shows the server error via toast', async () => {
  vi.mocked(preferencesApi.save).mockRejectedValue(new ApiError(400, 'BAD_REQUEST', '请求不合法'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: '保存' }))
  expect(await screen.findByText('请求不合法')).toBeInTheDocument()
})

it('shows a retry when loading fails', async () => {
  vi.mocked(preferencesApi.get).mockRejectedValueOnce(new Error('boom'))
  renderPage()
  expect(await screen.findByText('偏好加载失败')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByLabelText('女老师')).toBeChecked()
})
