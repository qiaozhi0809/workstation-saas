import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveWatermark } from './LiveWatermark'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
})
