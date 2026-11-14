import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  label?: React.ReactNode
  description?: React.ReactNode
}

/** 原生 <input type="checkbox">;16 px 方框,圆角 sm,外层 label 点击区 ≥ 32。 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, className, disabled, ...props }, ref) => (
    <label
      className={cn(
        'inline-flex min-h-8 items-start gap-2 py-1',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className="peer h-4 w-4 cursor-[inherit] appearance-none rounded-sm bg-background shadow-[inset_0_0_0_1px_hsl(var(--ws-input))] transition-colors checked:bg-[var(--control-on)] checked:shadow-none"
          {...props}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 h-4 w-4 p-0.5 text-[var(--control-glyph)] opacity-0 peer-checked:opacity-100"
        />
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className="text-sm">{label}</span>}
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </span>
      )}
    </label>
  ),
)
Checkbox.displayName = 'Checkbox'
