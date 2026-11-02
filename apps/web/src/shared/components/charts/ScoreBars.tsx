import { Bar, BarChart, Cell, LabelList, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/shared/components/ui/chart'
import { cn } from '@/shared/lib/utils'

export interface BarDatum { label: string; value: number; tone?: 'main' | 'low' | 'good'; tip?: string[] }
interface ChartBase { label: string; width?: number; height?: number; className?: string }

const TONE_COLOR = { main: 'hsl(var(--chart-1))', low: 'hsl(var(--chart-4))', good: 'hsl(var(--chart-3))' } as const
const CONFIG: ChartConfig = { value: { label: '数值', color: 'hsl(var(--chart-1))' } }

// 柱状图:各科得分率、分数段
export function ScoreBars({ label, width, height = 220, className, data, max, format, refLine, valueLabels }: ChartBase & {
  data: BarDatum[]; max?: number; format?: (v: number) => string; refLine?: { value: number; label: string }; valueLabels?: boolean
}) {
  const fmt = format ?? ((v: number) => String(v))
  const top = max ?? Math.max(1, refLine?.value ?? 0, ...data.map((d) => d.value))
  const chart = (
    <BarChart data={data} width={width} height={height} margin={{ top: 24, right: refLine ? 36 : 8, bottom: 0, left: 0 }}>
      <XAxis dataKey="label" tickLine={false} axisLine={false} />
      <YAxis domain={[0, top]} allowDecimals={false} tickFormatter={fmt} tickLine={false} axisLine={false} width={44} />
      <Tooltip
        cursor={false}
        content={({ active, payload }) => {
          const d = active ? (payload?.[0]?.payload as BarDatum | undefined) : undefined
          if (!d) return null
          return (
            <div className="rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
              <div className="font-medium">{d.label}:{fmt(d.value)}</div>
              {d.tip?.map((t) => <div key={t} className="text-muted-foreground">{t}</div>)}
            </div>
          )
        }}
      />
      <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((d, i) => <Cell key={i} fill={TONE_COLOR[d.tone ?? 'main']} />)}
        {valueLabels && <LabelList dataKey="value" position="top" formatter={(v: number) => fmt(v)} className="fill-foreground" />}
      </Bar>
      {refLine && (
        <ReferenceLine y={refLine.value} stroke="hsl(var(--chart-5))" strokeDasharray="4 4"
          label={{ value: refLine.label, position: 'right', fill: 'hsl(var(--chart-5))', fontSize: 12 }} />
      )}
    </BarChart>
  )
  return (
    <ChartContainer config={CONFIG} role="img" aria-label={label} fixedSize={width != null}
      className={cn('aspect-auto', className)} style={{ height, ...(width != null ? { width } : null) }}>
      {chart}
    </ChartContainer>
  )
}
