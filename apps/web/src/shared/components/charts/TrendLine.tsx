import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/shared/components/ui/chart'
import { cn } from '@/shared/lib/utils'

export interface LineSeries {
  key: string
  label: string
  values: (number | null)[]
  muted?: boolean
}
interface ChartBase {
  label: string
  width?: number
  height?: number
  className?: string
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]
const MUTED = 'hsl(var(--chart-2))'

// 折线:null 断开;endLabel 在主系列(第一个非 muted)最后一个非空点上方显示 format(值)
export function TrendLine({
  label,
  width,
  height = 220,
  className,
  labels,
  series,
  domain,
  reversed,
  format,
  endLabel,
  yAxisWidth = 40,
}: ChartBase & {
  labels: string[]
  series: LineSeries[]
  domain?: [number, number]
  reversed?: boolean
  format?: (v: number) => string
  endLabel?: boolean
  yAxisWidth?: number
}) {
  const fmt = format ?? ((v: number) => String(v))
  const data = labels.map((x, i) => ({
    x,
    ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? null])),
  }))
  const main = series.find((s) => !s.muted)
  let colorIdx = 0
  const colored = series.map((s) => ({
    s,
    color: s.muted ? MUTED : COLORS[colorIdx++ % COLORS.length],
  }))
  const config: ChartConfig = Object.fromEntries(
    colored.map(({ s, color }) => [s.key, { label: s.label, color }]),
  )
  const lastIdx = main ? main.values.reduce<number>((acc, v, i) => (v == null ? acc : i), -1) : -1

  const chart = (
    <LineChart
      data={data}
      width={width}
      height={height}
      margin={{ top: 20, right: 16, bottom: 0, left: 0 }}
    >
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis
        dataKey="x"
        tickLine={false}
        axisLine={false}
        padding={{ left: 16, right: 16 }}
        tickMargin={8}
      />
      <YAxis
        domain={domain ?? (reversed ? [1, 'dataMax'] : ['auto', 'auto'])}
        allowDecimals={false}
        reversed={reversed}
        tickFormatter={fmt}
        tickLine={false}
        axisLine={false}
        width={yAxisWidth}
      />
      <Tooltip
        formatter={(v, name) => [
          typeof v === 'number' ? fmt(v) : v,
          config[String(name)]?.label ?? name,
        ]}
        contentStyle={{
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 6,
          fontSize: 12,
        }}
      />
      {colored.map(({ s, color }) => (
        <Line
          key={s.key}
          dataKey={s.key}
          name={s.key}
          type="monotone"
          stroke={color}
          strokeWidth={s.muted ? 1.5 : 2}
          strokeDasharray={s.muted ? '4 4' : undefined}
          dot={{ r: s.muted ? 0 : 3, fill: color }}
          connectNulls={false}
          isAnimationActive={false}
          label={
            endLabel && s === main
              ? (((p: { x?: number; y?: number; index?: number; value?: number }) =>
                  p.index === lastIdx && p.value != null ? (
                    <text
                      key="end"
                      x={p.x}
                      y={(p.y ?? 0) - 8}
                      textAnchor="middle"
                      fontSize={12}
                      className="fill-foreground"
                    >
                      {fmt(p.value)}
                    </text>
                  ) : (
                    <g key={`n${p.index}`} />
                  )) as never)
              : undefined
          }
        />
      ))}
    </LineChart>
  )
  return (
    <ChartContainer
      config={config}
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
