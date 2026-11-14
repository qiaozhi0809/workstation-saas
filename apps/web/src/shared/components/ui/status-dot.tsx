import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
}

/** 6 px 圆点 + 文字:颜色不单独表达状态,文字一定在。 */
export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone])} />
      <span>{children}</span>
    </span>
  )
}
