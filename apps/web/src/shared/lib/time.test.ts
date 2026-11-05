import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDeadline, localTz } from './time'

afterEach(() => vi.restoreAllMocks())

describe('localTz', () => {
  it('返回浏览器时区', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/New_York' } as Intl.ResolvedDateTimeFormatOptions)
    expect(localTz()).toBe('America/New_York')
  })
  it('取不到或为空时回落 Asia/Shanghai', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions)
    expect(localTz()).toBe('Asia/Shanghai')
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({} as Intl.ResolvedDateTimeFormatOptions)
    expect(localTz()).toBe('Asia/Shanghai')
  })
  it('抛错时回落 Asia/Shanghai', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => { throw new Error('x') })
    expect(localTz()).toBe('Asia/Shanghai')
  })
})

describe('formatDeadline', () => {
  it('按本地时区格式化为 MM-DD HH:mm 截止', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Shanghai' } as Intl.ResolvedDateTimeFormatOptions)
    expect(formatDeadline('2026-11-10T10:30:00Z')).toBe('11-10 18:30 截止')
  })
  it('跨日换算', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Shanghai' } as Intl.ResolvedDateTimeFormatOptions)
    expect(formatDeadline('2026-12-31T20:05:00Z')).toBe('01-01 04:05 截止')
  })
})
