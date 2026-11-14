import { Button } from '@/shared/components/ui/button'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import type { Problem } from './errors'
import type { Draft } from './useUpgradeDraft'

const ORDER = ['name', 'start_date', 'end_date'] as const

export default function StepYear({
  year,
  hasPlan,
  busy,
  problem,
  onChange,
  onSuggest,
}: {
  year: Draft['year']
  hasPlan: boolean
  busy: boolean
  problem: Problem | null
  onChange(patch: Partial<Draft['year']>): void
  onSuggest(): void
}) {
  // new_year 没有 index,只看 field
  const hit = (f: string) => problem?.section === 'new_year' && problem.field === f
  const { errors, report, clear, fieldRef } = useFormErrors(ORDER)
  const submit = () => {
    const next: Partial<Record<(typeof ORDER)[number], string>> = {}
    if (!year.name.trim()) next.name = '请填写学年名称'
    if (!year.start_date) next.start_date = '请选择开学日期'
    if (!year.end_date) next.end_date = '请选择结束日期'
    else if (year.start_date && year.start_date >= year.end_date)
      next.end_date = '结束日期须晚于开学日期'
    if (!report(next)) return
    onSuggest()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        填写新学年的名称与起止日期,系统按"升一级、毕业班毕业"给出建议方案,之后可以逐步调整。
      </p>
      <Field label="学年名称" error={errors.name}>
        <Input
          ref={fieldRef('name')}
          aria-invalid={hit('name') || undefined}
          placeholder="如 2027-2028学年"
          maxLength={20}
          value={year.name}
          onChange={(e) => {
            clear('name')
            onChange({ name: e.target.value })
          }}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="开学日期" error={errors.start_date}>
          <Input
            ref={fieldRef('start_date')}
            type="date"
            aria-invalid={hit('start_date') || undefined}
            value={year.start_date}
            onChange={(e) => {
              clear('start_date')
              clear('end_date')
              onChange({ start_date: e.target.value })
            }}
          />
        </Field>
        <Field label="结束日期" error={errors.end_date}>
          <Input
            ref={fieldRef('end_date')}
            type="date"
            aria-invalid={hit('end_date') || undefined}
            value={year.end_date}
            onChange={(e) => {
              clear('end_date')
              onChange({ end_date: e.target.value })
            }}
          />
        </Field>
      </div>
      {problem?.section === 'new_year' && (
        <p className="text-sm text-destructive">{problem.message}</p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={busy} onClick={submit}>
          生成建议
        </Button>
        {hasPlan && (
          <span className="text-sm text-muted-foreground">已有草稿方案,重新生成会覆盖它</span>
        )}
      </div>
    </div>
  )
}
