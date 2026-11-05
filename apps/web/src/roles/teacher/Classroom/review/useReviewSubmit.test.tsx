import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { newOpId } from '@/shared/api/opId'
import { reviewsApi } from '@/shared/api/reviews'
import { useReviewSubmit } from './useReviewSubmit'

vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/opId', () => ({ newOpId: vi.fn() }))

const body = { category: 'whole_class' as const, reason_text: '全班表现好', score_delta: 1 }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.resetAllMocks()
  let n = 0
  vi.mocked(newOpId).mockImplementation(() => `op-${++n}`)
  vi.mocked(reviewsApi.create).mockResolvedValue({ items: [] })
})

it('does not lock submissions when op id generation throws', async () => {
  vi.mocked(newOpId).mockImplementationOnce(() => {
    throw new Error('no crypto')
  })
  const { result } = renderHook(() => useReviewSubmit('c1', ''), { wrapper })
  expect(() => result.current.submit(body)).toThrow('no crypto')
  expect(reviewsApi.create).not.toHaveBeenCalled()
  act(() => result.current.submit(body))
  await waitFor(() =>
    expect(reviewsApi.create).toHaveBeenCalledWith('c1', { op_id: 'op-1', ...body }),
  )
})

it('adds the current subject to the payload', async () => {
  const { result } = renderHook(() => useReviewSubmit('c1', '化学'), { wrapper })
  act(() => result.current.submit(body))
  await waitFor(() =>
    expect(reviewsApi.create).toHaveBeenCalledWith('c1', {
      op_id: 'op-1',
      ...body,
      subject: '化学',
    }),
  )
})

it('invalidates the drawer review detail after a successful review', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const spy = vi.spyOn(client, 'invalidateQueries')
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useReviewSubmit('c1', ''), { wrapper: w })
  act(() => result.current.submit(body))
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['student-reviews', 'c1'] }))
})
