import { render, screen } from '@testing-library/react'
import { ScoreBars } from './ScoreBars'
import { TrendLine } from './TrendLine'
import { ScoreRadar } from './ScoreRadar'
import { Sparkline } from './Sparkline'

describe('charts', () => {
  it('draws one bar per datum and the reference line', () => {
    const { container } = render(
      <ScoreBars label="各科得分率" width={400} data={[{ label: '语文', value: 80 }, { label: '数学', value: 55 }]}
        refLine={{ value: 60, label: '及格' }} />,
    )
    expect(screen.getByRole('img', { name: '各科得分率' })).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2)
    expect(screen.getByText('及格')).toBeInTheDocument()
  })

  it('breaks a line at null values', () => {
    const { container } = render(
      <TrendLine label="趋势" width={400} labels={['a', 'b', 'c']}
        series={[{ key: 'me', label: '我', values: [80, null, 70] }]} />,
    )
    const path = container.querySelector('.recharts-line-curve')
    expect(path).not.toBeNull()
    expect((path!.getAttribute('d') ?? '').match(/M/g)).toHaveLength(2)
  })

  it('uses only integer ticks (>= 1) for a reversed rank series', () => {
    const { container } = render(
      <TrendLine label="名次" width={400} reversed format={(v) => `第 ${v} 名`} labels={['a', 'b']}
        series={[{ key: 'me', label: '我', values: [1, 2] }]} />,
    )
    const ticks = Array.from(container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value'), (t) => t.textContent ?? '')
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      const n = Number(/\d+(\.\d+)?/.exec(t)?.[0])
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
    }
  })

  it('shows the end label of the main series', () => {
    const { container } = render(
      <TrendLine label="趋势" width={400} labels={['a', 'b', 'c']} endLabel format={(v) => `${v}%`}
        series={[
          { key: 'avg', label: '平均', values: [50, 51, 52], muted: true },
          { key: 'me', label: '我', values: [60, 65, 72] },
        ]} />,
    )
    // 只在主系列最后一个非空点上有标签(坐标轴刻度不在 .recharts-line 内)
    const labels = Array.from(container.querySelectorAll('.recharts-line text'), (t) => t.textContent)
    expect(labels).toEqual(['72%'])
  })

  it('draws a radar polygon per series', () => {
    const { container } = render(
      <ScoreRadar label="学科画像" width={300} axes={['语文', '数学', '英语']}
        series={[{ key: 'me', label: '我', values: [80, 70, 90] }, { key: 'avg', label: '班级平均', values: [60, 65, 70], muted: true }]} />,
    )
    expect(screen.getByRole('img', { name: '学科画像' })).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-radar-polygon')).toHaveLength(2)
  })

  it('renders a sparkline without axes', () => {
    const { container } = render(<Sparkline label="迷你趋势" width={100} height={30} values={[1, 3, null, 2]} />)
    expect(screen.getByRole('img', { name: '迷你趋势' })).toBeInTheDocument()
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
    expect(container.querySelector('.recharts-cartesian-axis')).toBeNull()
  })
})
