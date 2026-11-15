import type { ReactNode } from 'react'
import { Line, LineChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/shared/components/ui/chart'
import { cn } from '@/shared/lib/utils'
import { ChartSummary, type ChartPoint } from './ChartSummary'

interface ChartBase {
  label: string
  width?: number
  height?: number
  className?: string
}

const CONFIG: ChartConfig = { v: { label: '数值', color: 'hsl(var(--ws-chart-1))' } }

// 迷你曲线:无坐标轴、无交互;null 断开
export function Sparkline({
  label,
  width,
  height = 220,
  className,
  values,
  minPoints = 1,
  summary,
}: ChartBase & {
  values: (number | null)[]
  /** 有效点数少于它时不画图,改渲染 summary(默认「数据不足」);默认 1:至少有一个有效点时行为不变,零个有效点时不再画空坐标图,改显示摘要 */
  minPoints?: number
  summary?: (points: ChartPoint[]) => ReactNode
}) {
  const points: ChartPoint[] = values.flatMap((v, i) =>
    v == null ? [] : [{ label: String(i + 1), value: v }],
  )
  if (points.length < minPoints) return <ChartSummary points={points} summary={summary} />
  const data = values.map((v) => ({ v }))
  const chart = (
    <LineChart
      data={data}
      width={width}
      height={height}
      margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
    >
      <Line
        dataKey="v"
        type="monotone"
        stroke="hsl(var(--ws-chart-1))"
        strokeWidth={1.5}
        dot={false}
        connectNulls={false}
        isAnimationActive={false}
        activeDot={false}
      />
    </LineChart>
  )
  return (
    <ChartContainer
      config={CONFIG}
      role="img"
      aria-label={label}
      fixedSize={width != null}
      className={cn('aspect-auto', className)}
      style={{ height, ...(width != null ? { width } : null) }}
    >
      {chart}
    </ChartContainer>
  )
}
