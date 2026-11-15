import * as React from 'react'
import { cn } from '@/shared/lib/utils'

export interface SwitchProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'role' | 'size'
> {
  /** 可见文字;不给就必须给 aria-label */
  label?: React.ReactNode
  description?: React.ReactNode
}

/** 原生 <input type="checkbox" role="switch">,透明地盖在轨道上(可被直接点击);外层 label 点击区 ≥ 32,开启色 var(--control-on)。 */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    { label, description, className, checked, defaultChecked, onChange, disabled, ...props },
    ref,
  ) => {
    const [inner, setInner] = React.useState(Boolean(defaultChecked))
    const isControlled = checked !== undefined
    const on = isControlled ? Boolean(checked) : inner
    return (
      <label
        className={cn(
          'inline-flex min-h-8 items-start gap-3 py-1',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className,
        )}
      >
        <span className="relative mt-0.5 h-5 w-9 shrink-0">
          <input
            ref={ref}
            type="checkbox"
            role="switch"
            className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-[inherit] opacity-0"
            checked={on}
            aria-checked={on}
            disabled={disabled}
            onChange={(e) => {
              if (!isControlled) setInner(e.target.checked)
              onChange?.(e)
            }}
            {...props}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none relative block h-full w-full rounded-full bg-muted transition-colors peer-checked:bg-[var(--control-on)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-background after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
          />
        </span>
        {(label || description) && (
          <span className="flex min-w-0 flex-col">
            {label && <span className="text-sm">{label}</span>}
            {description && <span className="text-xs text-muted-foreground">{description}</span>}
          </span>
        )}
      </label>
    )
  },
)
Switch.displayName = 'Switch'
