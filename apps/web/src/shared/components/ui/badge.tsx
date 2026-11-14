import * as React from 'react'
import { cva } from 'class-variance-authority'

import { Badge as ArcBadge, type BadgeTone } from '@/shared/components/arc/badge/badge'

type Variant =
  | 'default'
  | 'secondary'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'destructive'
  | 'outline'

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  variant?: Variant
}

const TONE: Record<Exclude<Variant, 'outline'>, BadgeTone> = {
  default: 'neutral',
  secondary: 'neutral',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  info: 'info',
  danger: 'danger',
  destructive: 'danger',
}

function Badge({ variant = 'default', ...props }: BadgeProps) {
  const outline = variant === 'outline'
  const tone = outline ? 'neutral' : TONE[variant]
  return <ArcBadge tone={tone} outline={outline} {...props} />
}

// 只给还没改成 <Badge> 的调用点(教室未排座托盘)留着;新代码用 <Badge>
const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/10 text-destructive',
        outline: 'text-foreground shadow-surface',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        info: 'bg-info/10 text-info',
        danger: 'bg-destructive/10 text-destructive',
        neutral: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export { Badge, badgeVariants }
