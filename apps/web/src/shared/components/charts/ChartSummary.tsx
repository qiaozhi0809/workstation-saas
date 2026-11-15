import type { ReactNode } from 'react'

export interface ChartPoint {
  label: string
  value: number
}

/** 点数不足 minPoints 时代替图表显示的一行摘要;TrendLine 与 Sparkline 共用 */
export function ChartSummary({
  points,
  summary,
}: {
  points: ChartPoint[]
  summary?: (points: ChartPoint[]) => ReactNode
}) {
  return <p className="text-sm text-muted-foreground">{summary?.(points) ?? '数据不足'}</p>
}
