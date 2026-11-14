import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'

import { Button as ArcButton } from '@/shared/components/arc/button/button'
import { cn } from '@/shared/lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'touch'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
  loading?: boolean
}

const ARC_VARIANT = {
  default: 'primary',
  secondary: 'secondary',
  outline: 'secondary',
  ghost: 'ghost',
  destructive: 'danger',
} as const
const ARC_SIZE = { default: 'md', sm: 'sm', lg: 'lg' } as const

// asChild、链接、Menu 触发器、图标按钮走这一套类(不经过 Arc Button)
const projectButton = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'bg-background shadow-surface hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-12 px-6',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        touch: 'min-h-11 min-w-11 px-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/** 给 asChild、链接、Menu 触发器用的按钮类名。 */
export function buttonClass(opts: {
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}) {
  return projectButton(opts)
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      asChild = false,
      loading,
      type,
      onClick,
      ...props
    },
    ref,
  ) => {
    // 原生 button 默认 type="submit",放进表单里会误提交(L13):这里默认 "button",要提交的显式写 type="submit";
    // asChild 时子元素多半是链接,不塞 type
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(buttonClass({ variant, size }), className)}
          {...(type ? { type } : {})}
          {...props}
          aria-busy={loading || props['aria-busy'] || undefined}
          aria-disabled={loading || props['aria-disabled'] || undefined}
          onClick={loading ? (event: React.MouseEvent) => event.preventDefault() : onClick}
        />
      )
    }
    if (variant !== 'link' && size in ARC_SIZE) {
      return (
        <ArcButton
          ref={ref}
          variant={ARC_VARIANT[variant]}
          size={ARC_SIZE[size as keyof typeof ARC_SIZE]}
          loading={loading}
          className={className}
          type={type ?? 'button'}
          onClick={onClick}
          {...props}
        />
      )
    }
    return (
      <button
        ref={ref}
        className={cn(buttonClass({ variant, size }), className)}
        type={type ?? 'button'}
        {...props}
        aria-busy={loading || props['aria-busy'] || undefined}
        aria-disabled={loading || props['aria-disabled'] || undefined}
        onClick={loading ? (event) => event.preventDefault() : onClick}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button }
