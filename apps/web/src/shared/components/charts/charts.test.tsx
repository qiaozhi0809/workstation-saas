import { render, screen } from '@testing-library/react'
import { ScoreBars } from './ScoreBars'
import { TrendLine } from './TrendLine'
import { ScoreRadar } from './ScoreRadar'
import { Sparkline } from './Sparkline'

describe('charts', () => {
  it('draws one bar per datum and the reference line', () => {
    const { container } = render(
      <ScoreBars
        label="各科得分率"
        width={400}
        data={[
          { label: '语文', value: 80 },
          { label: '数学', value: 55 },
        ]}
        refLine={{ value: 60, label: '及格' }}
      />,
    )
    expect(screen.getByRole('img', { name: '各科得分率' })).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2)
    expect(screen.getByText('及格')).toBeInTheDocument()
  })

  it('breaks a line at null values', () => {
    const { container } = render(
      <TrendLine
        label="趋势"
        width={400}
        labels={['a', 'b', 'c']}
        series={[{ key: 'me', label: '我', values: [80, null, 70] }]}
      />,
    )
    const path = container.querySelector('.recharts-line-curve')
    expect(path).not.toBeNull()
    expect((path!.getAttribute('d') ?? '').match(/M/g)).toHaveLength(2)
  })

  it('uses only integer ticks (>= 1) for a reversed rank series', () => {
    const { container } = render(
      <TrendLine
        label="名次"
        width={400}
        reversed
        format={(v) => `第 ${v} 名`}
        labels={['a', 'b']}
        series={[{ key: 'me', label: '我', values: [1, 2] }]}
      />,
    )
    const ticks = Array.from(
      container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
      (t) => t.textContent ?? '',
    )
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      const n = Number(/\d+(\.\d+)?/.exec(t)?.[0])
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
    }
  })

  it('widens the y axis with yAxisWidth', () => {
    const tickX = (w?: number) => {
      const { container, unmount } = render(
        <TrendLine
          label="名次"
          width={400}
          reversed
          yAxisWidth={w}
          labels={['a', 'b']}
          series={[{ key: 'me', label: '我', values: [1, 2] }]}
        />,
      )
      const x = Number(
        container
          .querySelector('.recharts-yAxis .recharts-cartesian-axis-tick-value')!
          .getAttribute('x'),
      )
      unmount()
      return x
    }
    // 刻度右对齐到 Y 轴右缘,宽度加 16 则刻度整体右移 16;默认仍是 40
    expect(tickX(56) - tickX()).toBe(16)
    expect(tickX(40)).toBe(tickX())
  })

  it('keeps the first x label clear of the y axis and off the axis line', () => {
    const { container } = render(
      <TrendLine
        label="趋势"
        width={400}
        labels={['a', 'b']}
        series={[{ key: 'me', label: '我', values: [80, 70] }]}
      />,
    )
    const plotLeft = 40 // 默认 yAxisWidth,left margin 0
    const dot = container.querySelector('.recharts-line-dot')!
    expect(Number(dot.getAttribute('cx'))).toBeGreaterThanOrEqual(plotLeft + 16)
    const tick = container.querySelector('.recharts-xAxis .recharts-cartesian-axis-tick-value')!
    // 轴顶 = 220 - 30;刻度线长 6 + tickMargin 8
    expect(Number(tick.getAttribute('y'))).toBeGreaterThanOrEqual(220 - 30 + 6 + 8)
  })

  it('gives the score bars y axis 44px so 100% is not clipped', () => {
    const tickX = (w: number) => {
      const { container, unmount } = render(
        <ScoreBars
          label="x"
          width={w}
          data={[{ label: 'a', value: 100 }]}
          format={(v) => `${v}%`}
        />,
      )
      const x = Number(
        container
          .querySelector('.recharts-yAxis .recharts-cartesian-axis-tick-value')!
          .getAttribute('x'),
      )
      unmount()
      return x
    }
    expect(tickX(400)).toBe(36) // 刻度右对齐到轴右缘内 8px:宽度 44 - 8
  })

  it('uses integer y ticks for count data', () => {
    const { container } = render(
      <ScoreBars
        label="分数段"
        width={400}
        data={[
          { label: 'a', value: 1 },
          { label: 'b', value: 2 },
          { label: 'c', value: 3 },
        ]}
      />,
    )
    const ticks = Array.from(
      container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
      (t) => t.textContent ?? '',
    )
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) expect(Number.isInteger(Number(t))).toBe(true)
  })

  it('puts the reference line label right of the last bar', () => {
    const { container } = render(
      <ScoreBars
        label="各科得分率"
        width={400}
        max={100}
        data={[
          { label: '语文', value: 80 },
          { label: '数学', value: 55 },
        ]}
        refLine={{ value: 60, label: '及格' }}
      />,
    )
    const bars = container.querySelectorAll('.recharts-bar-rectangle path')
    const last = bars[bars.length - 1]
    const barRight = Number(last.getAttribute('x')) + Number(last.getAttribute('width'))
    const label = screen.getByText('及格').closest('text')!
    // 左对齐地从绘图区右缘外开始写,不会盖在柱子上
    expect(label.getAttribute('text-anchor')).toBe('start')
    expect(Number(label.getAttribute('x'))).toBeGreaterThanOrEqual(barRight)
    // 右边距够放下两个 12px 的字(24px)
    expect(Number(label.getAttribute('x')) + 24).toBeLessThanOrEqual(400)
  })

  it('keeps the top y tick from being clipped', () => {
    const { container } = render(
      <ScoreBars
        label="各科得分率"
        width={400}
        max={100}
        data={[{ label: '语文', value: 80 }]}
        refLine={{ value: 60, label: '及格' }}
      />,
    )
    const ys = Array.from(
      container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'),
      (t) => Number(t.getAttribute('y')),
    )
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(24) // margin.top=24,留足半行文字
  })

  it('shows the end label of the main series', () => {
    const { container } = render(
      <TrendLine
        label="趋势"
        width={400}
        labels={['a', 'b', 'c']}
        endLabel
        format={(v) => `${v}%`}
        series={[
          { key: 'avg', label: '平均', values: [50, 51, 52], muted: true },
          { key: 'me', label: '我', values: [60, 65, 72] },
        ]}
      />,
    )
    // 只在主系列最后一个非空点上有标签(坐标轴刻度不在 .recharts-line 内)
    const labels = Array.from(
      container.querySelectorAll('.recharts-line text'),
      (t) => t.textContent,
    )
    expect(labels).toEqual(['72%'])
  })

  it('draws a radar polygon per series', () => {
    const { container } = render(
      <ScoreRadar
        label="学科画像"
        width={300}
        axes={['语文', '数学', '英语']}
        series={[
          { key: 'me', label: '我', values: [80, 70, 90] },
          { key: 'avg', label: '班级平均', values: [60, 65, 70], muted: true },
        ]}
      />,
    )
    expect(screen.getByRole('img', { name: '学科画像' })).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-radar-polygon')).toHaveLength(2)
  })

  it('renders a sparkline without axes', () => {
    const { container } = render(
      <Sparkline label="迷你趋势" width={100} height={30} values={[1, 3, null, 2]} />,
    )
    expect(screen.getByRole('img', { name: '迷你趋势' })).toBeInTheDocument()
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
    expect(container.querySelector('.recharts-cartesian-axis')).toBeNull()
  })
})
