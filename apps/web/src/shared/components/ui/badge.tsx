import * as React from 'react'

import { Badge as ArcBadge, type BadgeTone } from '@/shared/components/arc/badge/badge'

type Variant = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'outline'

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  variant?: Variant
}

const TONE: Record<Exclude<Variant, 'outline'>, BadgeTone> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  info: 'info',
  danger: 'danger',
}

function Badge({ variant = 'neutral', children, ...props }: BadgeProps) {
  const outline = variant === 'outline'
  const tone = outline ? 'neutral' : TONE[variant]
  // children 包一层 Fragment:Arc 对纯字符串会走文字切换动画,旧文字的退出副本会在 DOM 里多留一会儿
  return (
    <ArcBadge tone={tone} outline={outline} {...props}>
      <>{children}</>
    </ArcBadge>
  )
}

export { Badge }
