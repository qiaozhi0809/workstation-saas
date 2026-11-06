import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { schoolApi } from '@/shared/api/school'
import { DEFAULT_GRADING } from '@/shared/lib/grades'
import { GRADING_QUERY_KEY, useGrading } from './useGrading'

vi.mock('@/shared/api/school', () => ({ schoolApi: { grading: vi.fn() } }))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

it('returns the default ratios while loading, then the school ratios', async () => {
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  const { result } = renderHook(() => useGrading(), { wrapper })
  expect(result.current).toEqual(DEFAULT_GRADING)
  await waitFor(() => expect(result.current).toEqual({ pass_ratio: 0.7, good_ratio: 0.9 }))
  expect(GRADING_QUERY_KEY).toEqual(['school', 'grading'])
  expect(client.getQueryData(['school', 'grading'])).toEqual({ pass_ratio: 0.7, good_ratio: 0.9 })
})

it('keeps the cached value fresh for 60 seconds and refetches after invalidation', async () => {
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  const a = renderHook(() => useGrading(), { wrapper })
  await waitFor(() => expect(a.result.current.pass_ratio).toBe(0.7))
  a.unmount()
  const b = renderHook(() => useGrading(), { wrapper })
  expect(b.result.current.pass_ratio).toBe(0.7)
  expect(schoolApi.grading).toHaveBeenCalledTimes(1)
  const query = client.getQueryCache().find({ queryKey: ['school', 'grading'] })
  expect(query?.observers[0]?.options.staleTime).toBe(60_000)
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.5, good_ratio: 0.8 })
  await client.invalidateQueries({ queryKey: ['school', 'grading'] })
  await waitFor(() => expect(b.result.current.pass_ratio).toBe(0.5))
})

it('falls back to the default ratios when the request fails', async () => {
  vi.mocked(schoolApi.grading).mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useGrading(), { wrapper })
  await waitFor(() => expect(schoolApi.grading).toHaveBeenCalled())
  await waitFor(() =>
    expect(client.getQueryCache().find({ queryKey: ['school', 'grading'] })?.state.status).toBe(
      'error',
    ),
  )
  expect(result.current).toEqual(DEFAULT_GRADING)
})
