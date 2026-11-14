import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  'aria-label': string
  icon: LucideIcon
  size?: 'sm' | 'md' | 'touch'
  variant?: 'ghost' | 'outline'
}

const SIZE = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  touch: 'min-h-11 min-w-11',
} as const

const VARIANT = {
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  outline:
    'bg-background shadow-[inset_0_0_0_1px_hsl(var(--ws-input))] hover:bg-accent hover:text-accent-foreground',
} as const

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, size = 'md', variant = 'ghost', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50',
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  ),
)
IconButton.displayName = 'IconButton'
