import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parentApi } from '@/shared/api/parent'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import type { ParentGrowthRecord, ParentReview } from '@/shared/types/parent'
import ParentLayout from '../ParentLayout'
import { child, mockWidth, setParentUser } from '../testkit'
import GrowthPage from './GrowthPage'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), growth: vi.fn(), comments: vi.fn(), reviews: vi.fn() },
}))

const rec = (id: string, date: string, year_name: string, over: Partial<ParentGrowthRecord> = {}): ParentGrowthRecord => ({
  id, type: '表扬', date, content: `内容${id}`, year_name, created_by_name: '陈老师', ...over,
})
const rev = (id: string, over: Partial<ParentReview> = {}): ParentReview => ({
  id, reason_text: `点评${id}`, score_delta: 1, subject: null, given_at: '2026-10-01T01:00:00Z', given_by_name: '李老师', ...over,
})

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/parent/growth?child=s1']}>
        <Routes>
          <Route path="/parent" element={<ProtectedRoute context="parent"><ParentLayout /></ProtectedRoute>}>
            <Route path="growth" element={<GrowthPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue([child()])
  vi.mocked(parentApi.growth).mockResolvedValue({ items: [] })
  vi.mocked(parentApi.comments).mockResolvedValue({ items: [] })
  vi.mocked(parentApi.reviews).mockResolvedValue({ items: [], next_cursor: null })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const goTab = async (name: string) => fireEvent.click(await screen.findByRole('tab', { name }))

it('exposes three tabs and selects the growth tab first', async () => {
  open()
  const tabs = await screen.findAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual(['成长记录', '评语', '点评'])
  expect(screen.getByRole('tab', { name: '成长记录' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tablist')).toBeInTheDocument()
})

it('lists growth records by date descending with a year divider where the year changes', async () => {
  vi.mocked(parentApi.growth).mockResolvedValue({
    items: [rec('a', '2025-03-01', '2024-2025学年'), rec('b', '2026-05-01', '2025-2026学年'), rec('c', '2025-12-01', '2025-2026学年', { type: '获奖' })],
  })
  open()
  expect(await screen.findByText('内容b')).toBeInTheDocument()
  const texts = screen.getAllByText(/^内容/).map((e) => e.textContent)
  expect(texts).toEqual(['内容b', '内容c', '内容a'])
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['2025-2026学年', '2024-2025学年'])
  expect(within(screen.getByRole('region', { name: '2025-2026学年' })).getAllByText(/^内容/)).toHaveLength(2)
  expect(screen.getByText('获奖')).toBeInTheDocument()
})

it('says so when there are no growth records', async () => {
  open()
  expect(await screen.findByText('还没有成长记录')).toBeInTheDocument()
})

it('groups comments by semester', async () => {
  vi.mocked(parentApi.comments).mockResolvedValue({
    items: [
      { id: 'm1', semester: '2025-2026 第二学期', content: '进步明显', created_at: '2026-07-01T00:00:00Z' },
      { id: 'm2', semester: '2025-2026 第一学期', content: '认真踏实', created_at: '2026-01-10T00:00:00Z' },
      { id: 'm3', semester: '2025-2026 第二学期', content: '继续加油', created_at: '2026-07-02T00:00:00Z' },
    ],
  })
  open()
  await goTab('评语')
  const second = await screen.findByRole('region', { name: '2025-2026 第二学期' })
  expect(within(second).getByText('进步明显')).toBeInTheDocument()
  expect(within(second).getByText('继续加油')).toBeInTheDocument()
  const first = screen.getByRole('region', { name: '2025-2026 第一学期' })
  expect(within(first).getByText('认真踏实')).toBeInTheDocument()
})

it('says so when there are no comments', async () => {
  open()
  await goTab('评语')
  expect(await screen.findByText('还没有评语')).toBeInTheDocument()
})

it('requests the next review page when the sentinel scrolls into view and stops at a null cursor', async () => {
  let trigger: (() => void) | undefined
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { trigger = () => cb([{ isIntersecting: true }]) }
    observe() {} disconnect() {} unobserve() {}
  })
  vi.mocked(parentApi.reviews)
    .mockResolvedValueOnce({ items: [rev('1'), rev('2', { score_delta: -2 })], next_cursor: 'c1' })
    .mockResolvedValueOnce({ items: [rev('3')], next_cursor: null })
  open()
  await goTab('点评')
  expect(await screen.findByText('点评1')).toBeInTheDocument()
  expect(screen.getByText('+1')).toHaveClass('text-success')
  expect(screen.getByText('-2')).toHaveClass('text-destructive')
  expect(parentApi.reviews).toHaveBeenCalledTimes(1)
  expect(parentApi.reviews).toHaveBeenLastCalledWith('s1', undefined)
  trigger!()
  expect(await screen.findByText('点评3')).toBeInTheDocument()
  expect(parentApi.reviews).toHaveBeenLastCalledWith('s1', 'c1')
  expect(parentApi.reviews).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull())
})

it('has a load-more button fallback', async () => {
  vi.mocked(parentApi.reviews)
    .mockResolvedValueOnce({ items: [rev('1')], next_cursor: 'c1' })
    .mockResolvedValueOnce({ items: [rev('2')], next_cursor: null })
  open()
  await goTab('点评')
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
  expect(await screen.findByText('点评2')).toBeInTheDocument()
})

it('says so when there are no reviews', async () => {
  open()
  await goTab('点评')
  expect(await screen.findByText('还没有点评')).toBeInTheDocument()
})

it('shows a loading state then a retryable error', async () => {
  vi.mocked(parentApi.growth).mockRejectedValue(new Error('x'))
  open()
  expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
})

it('does not loop after a failed next page and offers a manual retry', async () => {
  let trigger: (() => void) | undefined
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { trigger = () => cb([{ isIntersecting: true }]) }
    observe() {} disconnect() {} unobserve() {}
  })
  vi.mocked(parentApi.reviews)
    .mockResolvedValueOnce({ items: [rev('1')], next_cursor: 'c1' })
    .mockRejectedValueOnce(new Error('x'))
    .mockResolvedValueOnce({ items: [rev('2')], next_cursor: null })
  open()
  await goTab('点评')
  await screen.findByText('点评1')
  trigger!()
  expect(await screen.findByText('加载更多失败')).toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 50))
  expect(parentApi.reviews).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
  expect(await screen.findByText('点评2')).toBeInTheDocument()
  expect(parentApi.reviews).toHaveBeenCalledTimes(3)
})

it('shows dates in school time, not the UTC date', async () => {
  vi.mocked(parentApi.reviews).mockResolvedValue({ items: [rev('1', { given_at: '2026-10-01T20:00:00Z' })], next_cursor: null })
  vi.mocked(parentApi.comments).mockResolvedValue({
    items: [{ id: 'm1', semester: '2025-2026 第一学期', content: '好', created_at: '2026-01-10T20:00:00Z' }],
  })
  open()
  await goTab('评语')
  expect(await screen.findByText('2026-01-11')).toBeInTheDocument()
  await goTab('点评')
  expect(await screen.findByText(/2026-10-02/)).toBeInTheDocument()
})

it('goes back to the growth tab when the child changes', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([child(), child({ student_id: 's2', name: '王小二' })])
  open()
  await goTab('评语')
  fireEvent.change(await screen.findByRole('combobox', { name: '切换孩子' }), { target: { value: 's2' } })
  await waitFor(() => expect(screen.getByRole('tab', { name: '成长记录' })).toHaveAttribute('aria-selected', 'true'))
})
