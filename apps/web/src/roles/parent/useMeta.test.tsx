import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { schoolApi } from '@/shared/api/school'
import { localTz } from '@/shared/lib/time'
import { useSchoolTz } from './useMeta'

vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))

const base = { version: '0.0.0-test', school_name: '示例小学' }
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  vi.resetAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

it('/meta 没回来前用浏览器时区,回来后用学校时区(L79)', async () => {
  vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'America/New_York' })
  const { result } = renderHook(() => useSchoolTz(), { wrapper })
  expect(result.current).toBe(localTz())
  await waitFor(() => expect(result.current).toBe('America/New_York'))
})

it('school_tz 不是合法时区名或为空时回落浏览器时区,不让 formatInTz 抛 RangeError', async () => {
  vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'Not/AZone' })
  const { result } = renderHook(() => useSchoolTz(), { wrapper })
  await waitFor(() => expect(schoolApi.meta).toHaveBeenCalled())
  await waitFor(() => expect(client.getQueryData(['meta'])).toBeDefined())
  expect(result.current).toBe(localTz())

  client.clear()
  vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: '' })
  const empty = renderHook(() => useSchoolTz(), { wrapper })
  await waitFor(() => expect(client.getQueryData(['meta'])).toBeDefined())
  expect(empty.result.current).toBe(localTz())
})
