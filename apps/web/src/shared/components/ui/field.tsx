import * as React from 'react'
import { Label } from './label'
import { cn } from '@/shared/lib/utils'

export interface FieldProps {
  label: string
  description?: React.ReactNode
  error?: string
  required?: boolean
  className?: string
  /** 单个控件;Field 用 cloneElement 注入 id、aria-describedby、aria-invalid */
  children: React.ReactElement
}

type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

/** label 12 → 控件 4 → 说明 / 错误。错误 role="alert"。必填标记只用样式画,不进 label 文本。 */
export function Field({ label, description, error, required, className, children }: FieldProps) {
  const autoId = React.useId()
  const control = children as React.ReactElement<ControlProps>
  const id = control.props.id ?? autoId
  const descId = description ? `${id}-desc` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [control.props['aria-describedby'], descId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label
        htmlFor={id}
        className={cn(required && "after:ml-0.5 after:text-destructive after:content-['*']")}
      >
        {label}
      </Label>
      {React.cloneElement(control, {
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(required ? { 'aria-required': true } : {}),
      })}
      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 提交时就地报错:按 order(不是 DOM 顺序)聚焦第一个出错的字段。
 * report 有错返回 false;fieldRef(key) 给控件的 ref。
 */
export function useFormErrors<K extends string>(order: readonly K[]) {
  const [errors, setErrors] = React.useState<Partial<Record<K, string>>>({})
  const elements = React.useRef(new Map<K, HTMLElement>())
  const refCallbacks = React.useRef(new Map<K, (el: HTMLElement | null) => void>())

  const report = React.useCallback(
    (next: Partial<Record<K, string>>) => {
      setErrors(next)
      const has = Object.values(next).some(Boolean)
      const first = order.find((key) => next[key])
      if (first !== undefined) elements.current.get(first)?.focus()
      return !has
    },
    [order],
  )

  const clear = React.useCallback((key: K) => {
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
  }, [])

  const fieldRef = React.useCallback((key: K) => {
    let cb = refCallbacks.current.get(key)
    if (!cb) {
      cb = (el) => {
        if (el) elements.current.set(key, el)
        else elements.current.delete(key)
      }
      refCallbacks.current.set(key, cb)
    }
    return cb
  }, [])

  return { errors, report, clear, fieldRef }
}
