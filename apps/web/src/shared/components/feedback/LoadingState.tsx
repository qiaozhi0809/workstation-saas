import { Loader2 } from 'lucide-react'
import { Skeleton } from '@/shared/components/arc/skeleton/skeleton'
import { useReducedMotion } from '@/shared/hooks/useReducedMotion'
import { cn } from '@/shared/lib/utils'

export type LoadingVariant = 'inline' | 'table' | 'cards' | 'form'

/**
 * inline = 转圈 + 文字(默认,与旧行为一致);table = 表头 + rows 行灰条;
 * cards = 3 张卡片高度的灰块;form = Arc Skeleton。
 */
export function LoadingState({
  label = '加载中…',
  variant = 'inline',
  rows = 5,
  className,
}: {
  label?: string
  variant?: LoadingVariant
  rows?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const bar = cn('rounded-md bg-muted', !reduced && 'animate-pulse')

  if (variant === 'inline') {
    return (
      <div
        role="status"
        className={cn(
          'flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground',
          className,
        )}
      >
        <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
        <span>{label}</span>
      </div>
    )
  }

  if (variant === 'form') {
    return <Skeleton label={label} lines={4} className={className} />
  }

  if (variant === 'cards') {
    return (
      <div
        role="status"
        aria-label={label}
        className={cn('grid gap-6 sm:grid-cols-2 lg:grid-cols-3', className)}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            data-skeleton-card
            aria-hidden="true"
            className={cn('h-32 rounded-lg', bar)}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-label={label}
      className={cn('rounded-lg bg-card shadow-surface', className)}
    >
      <div aria-hidden="true" className="flex h-10 items-center px-3">
        <div className={cn('h-3 w-24', bar)} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          data-skeleton-row
          aria-hidden="true"
          className="flex h-11 items-center gap-6 px-3"
        >
          <div className={cn('h-3 w-24', bar)} />
          <div className={cn('h-3 w-40', bar)} />
          <div className={cn('h-3 w-16', bar)} />
        </div>
      ))}
    </div>
  )
}
