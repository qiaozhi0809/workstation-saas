import { Line, LineChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/shared/components/ui/chart'
import { cn } from '@/shared/lib/utils'

interface ChartBase {
  label: string
  width?: number
  height?: number
  className?: string
}

const CONFIG: ChartConfig = { v: { label: '数值', color: 'hsl(var(--chart-1))' } }

// 迷你曲线:无坐标轴、无交互;null 断开
export function Sparkline({
  label,
  width,
  height = 220,
  className,
  values,
}: ChartBase & { values: (number | null)[] }) {
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
        stroke="hsl(var(--chart-1))"
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
