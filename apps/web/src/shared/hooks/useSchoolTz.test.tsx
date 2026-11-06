import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schoolApi } from '@/shared/api/school'
import { localTz } from '@/shared/lib/time'
import { monthIn, todayIn, useMeta, useSchoolTz } from './useSchoolTz'

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

describe('useSchoolTz', () => {
  it('/meta 没回来前 ready 为假、按浏览器时区;回来后 ready 为真、用学校时区', async () => {
    vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'America/New_York' })
    const { result } = renderHook(() => useSchoolTz(), { wrapper })
    expect(result.current).toEqual({ tz: localTz(), ready: false })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.tz).toBe('America/New_York')
  })

  it('school_tz 不是 Intl 认得的时区名或为空时回落浏览器时区,ready 仍为真', async () => {
    vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'Not/AZone' })
    const bad = renderHook(() => useSchoolTz(), { wrapper })
    await waitFor(() => expect(bad.result.current.ready).toBe(true))
    expect(bad.result.current.tz).toBe(localTz())

    client.clear()
    vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: '' })
    const empty = renderHook(() => useSchoolTz(), { wrapper })
    await waitFor(() => expect(empty.result.current.ready).toBe(true))
    expect(empty.result.current.tz).toBe(localTz())
  })

  it('/meta 失败时 ready 为真、按浏览器时区,页面照常可用', async () => {
    vi.mocked(schoolApi.meta).mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useSchoolTz(), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.tz).toBe(localTz())
  })
})

describe('useMeta', () => {
  it("用 m5d 约定的查询键 ['meta'],1 小时内不重取", async () => {
    vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'Asia/Shanghai' })
    const a = renderHook(() => useMeta(), { wrapper })
    await waitFor(() => expect(a.result.current.data?.school_tz).toBe('Asia/Shanghai'))
    a.unmount()
    const b = renderHook(() => useMeta(), { wrapper })
    expect(b.result.current.data?.school_name).toBe('示例小学')
    expect(schoolApi.meta).toHaveBeenCalledTimes(1)
    const query = client.getQueryCache().find({ queryKey: ['meta'] })
    expect(query?.observers[0]?.options.staleTime).toBe(60 * 60_000)
  })

  it('enabled 为假时不发请求(关于对话框打开时才取)', async () => {
    vi.mocked(schoolApi.meta).mockResolvedValue({ ...base, school_tz: 'Asia/Shanghai' })
    const { result, rerender } = renderHook(({ enabled }) => useMeta({ enabled }), {
      wrapper,
      initialProps: { enabled: false },
    })
    expect(result.current.isPending).toBe(true)
    expect(schoolApi.meta).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.data?.version).toBe('0.0.0-test'))
  })
})

describe('todayIn / monthIn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 上海已是 11-05 01:00,洛杉矶还是 11-04 10:00:两边日期不同才能区分出时区
    vi.setSystemTime(new Date('2026-11-04T17:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('按给定时区算今天与本月', () => {
    expect(todayIn('Asia/Shanghai')).toBe('2026-11-05')
    expect(monthIn('Asia/Shanghai')).toBe('2026-11')
    expect(todayIn('America/Los_Angeles')).toBe('2026-11-04')
    expect(monthIn('America/Los_Angeles')).toBe('2026-11')
  })

  it('时区名不合法时不抛错,按浏览器时区算', () => {
    expect(todayIn('Not/AZone')).toBe(todayIn(localTz()))
    expect(monthIn('')).toBe(monthIn(localTz()))
  })
})
