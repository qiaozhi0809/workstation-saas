import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
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
  expect(result.current).toMatchObject({ ...DEFAULT_GRADING, failed: false })
  await waitFor(() => expect(result.current).toMatchObject({ pass_ratio: 0.7, good_ratio: 0.9 }))
  expect(result.current.failed).toBe(false)
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

// L236:读取失败不再静默——仍按默认值给比例,但 failed 为真(成绩 / 分析页据此提示),retry 重新请求
it('exposes failure', async () => {
  vi.mocked(schoolApi.grading).mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useGrading(), { wrapper })
  expect(result.current.failed).toBe(false)
  await waitFor(() => expect(result.current.failed).toBe(true))
  expect(result.current).toMatchObject(DEFAULT_GRADING)
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.failed).toBe(false))
  expect(result.current).toMatchObject({ pass_ratio: 0.7, good_ratio: 0.9 })
  expect(schoolApi.grading).toHaveBeenCalledTimes(2)
})

it('does not report failure when only a background refetch fails', async () => {
  vi.mocked(schoolApi.grading).mockResolvedValue({ pass_ratio: 0.7, good_ratio: 0.9 })
  const { result } = renderHook(() => useGrading(), { wrapper })
  await waitFor(() => expect(result.current.pass_ratio).toBe(0.7))
  vi.mocked(schoolApi.grading).mockRejectedValue(new Error('boom'))
  await act(async () => {
    await client.refetchQueries({ queryKey: ['school', 'grading'] })
  })
  // 上一次读到的比例还在:继续用它,不打扰老师
  expect(result.current).toMatchObject({ pass_ratio: 0.7, good_ratio: 0.9, failed: false })
})
