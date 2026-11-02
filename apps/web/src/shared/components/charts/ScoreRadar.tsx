import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/shared/components/ui/chart'
import { cn } from '@/shared/lib/utils'
import type { LineSeries } from './TrendLine'

interface ChartBase { label: string; width?: number; height?: number; className?: string }

// 雷达:学科画像,本人 vs 班级平均,0–100;缺值按 0 画
export function ScoreRadar({ label, width, height = 220, className, axes, series }: ChartBase & { axes: string[]; series: LineSeries[] }) {
  const data = axes.map((axis, i) => ({ axis, ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? 0])) }))
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.muted ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))' }]),
  )
  const chart = (
    <RadarChart data={data} width={width} height={height}>
      <PolarGrid />
      <PolarAngleAxis dataKey="axis" />
      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
      <Tooltip
        contentStyle={{ background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
        formatter={(v, name) => [v, config[String(name)]?.label ?? name]}
      />
      {series.map((s) => {
        const color = config[s.key].color
        return (
          <Radar key={s.key} dataKey={s.key} name={s.key} stroke={color} fill={color}
            fillOpacity={s.muted ? 0.1 : 0.3} strokeDasharray={s.muted ? '4 4' : undefined} isAnimationActive={false} />
        )
      })}
    </RadarChart>
  )
  return (
    <ChartContainer config={config} role="img" aria-label={label} fixedSize={width != null}
      className={cn('aspect-auto', className)} style={{ height, ...(width != null ? { width } : null) }}>
      {chart}
    </ChartContainer>
  )
}
