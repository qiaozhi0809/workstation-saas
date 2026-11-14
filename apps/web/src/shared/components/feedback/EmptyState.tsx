import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  align = 'start',
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  align?: 'start' | 'center'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-8',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />}
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
