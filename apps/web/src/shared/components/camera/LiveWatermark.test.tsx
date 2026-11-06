import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveWatermark } from './LiveWatermark'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const browserZoneFormat = (d: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)

describe('LiveWatermark', () => {
  it('watermark shows viewer name and ticks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-02T01:00:00Z'))
    const { container, unmount } = render(
      <LiveWatermark schoolName="示例小学" viewerName="赵老师" timeZone="Asia/Shanghai" />,
    )
    const el = screen.getByText(/正在直播/)
    expect(el).toHaveTextContent('正在直播 · 示例小学 · 2026/11/02 09:00:00 · 赵老师')
    expect(container.firstElementChild).toHaveClass('pointer-events-none')
    act(() => void vi.advanceTimersByTime(1000))
    expect(el).toHaveTextContent('09:00:01')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders the hour in the given time zone', () => {
    vi.setSystemTime(new Date('2026-11-02T01:00:00Z'))
    const sh = render(<LiveWatermark schoolName="s" viewerName="v" timeZone="Asia/Shanghai" />)
    expect(sh.container).toHaveTextContent('09:00:00')
    sh.unmount()
    const ny = render(<LiveWatermark schoolName="s" viewerName="v" timeZone="America/New_York" />)
    expect(ny.container).toHaveTextContent('20:00:00')
  })

  it('falls back to the browser time zone on an invalid timeZone and warns once', () => {
    vi.useFakeTimers()
    const at = new Date('2026-11-02T01:00:00Z')
    vi.setSystemTime(at)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = 'Mars/Olympus_Mons'
    const a = render(<LiveWatermark schoolName="s" viewerName="v" timeZone={bad} />)
    expect(a.container).toHaveTextContent(browserZoneFormat(at))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toContain(bad)
    // 同一个坏时区再挂几块(九宫格)也只警告这一次;秒针照走
    render(<LiveWatermark schoolName="s" viewerName="v" timeZone={bad} />)
    act(() => void vi.advanceTimersByTime(1000))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(a.container).toHaveTextContent(browserZoneFormat(new Date(at.getTime() + 1000)))
    // 换成合法时区即恢复
    a.rerender(<LiveWatermark schoolName="s" viewerName="v" timeZone="Asia/Shanghai" />)
    expect(a.container).toHaveTextContent('09:00:01')
  })
})
