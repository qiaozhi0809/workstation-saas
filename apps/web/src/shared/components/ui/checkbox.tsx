import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  label?: React.ReactNode
  description?: React.ReactNode
  /** 部分选中(表格「全选」用);只设置 DOM 的 indeterminate,不改 checked */
  indeterminate?: boolean
}

/** 原生 <input type="checkbox">;16 px 方框,圆角 sm,外层 label 点击区 ≥ 32。 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, indeterminate = false, className, disabled, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement | null>(null)
    const setRef = React.useCallback(
      (el: HTMLInputElement | null) => {
        inner.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      },
      [ref],
    )
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate
    }, [indeterminate])

    return (
      <label
        className={cn(
          'inline-flex min-h-8 items-start gap-2 py-1',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          className,
        )}
      >
        <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
          <input
            ref={setRef}
            type="checkbox"
            disabled={disabled}
            className="peer h-4 w-4 cursor-[inherit] appearance-none rounded-sm bg-background shadow-[inset_0_0_0_1px_hsl(var(--ws-input))] transition-colors checked:bg-[var(--control-on)] checked:shadow-none indeterminate:bg-[var(--control-on)] indeterminate:shadow-none"
            {...props}
          />
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 h-4 w-4 p-0.5 text-[var(--control-glyph)] opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
          />
          <Minus
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 h-4 w-4 p-0.5 text-[var(--control-glyph)] opacity-0 peer-indeterminate:opacity-100"
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
Checkbox.displayName = 'Checkbox'
