import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import Field from '../Org/Field'
import type { Problem } from './errors'
import type { Draft } from './useUpgradeDraft'

export default function StepYear({ year, hasPlan, busy, problem, onChange, onSuggest }: {
  year: Draft['year']; hasPlan: boolean; busy: boolean; problem: Problem | null
  onChange(patch: Partial<Draft['year']>): void; onSuggest(): void
}) {
  // new_year 没有 index,只看 field
  const hit = (f: string) => problem?.section === 'new_year' && problem.field === f
  const ready = year.name.trim() !== '' && year.start_date !== '' && year.end_date !== '' && year.start_date < year.end_date
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        填写新学年的名称与起止日期,系统按"升一级、毕业班毕业"给出建议方案,之后可以逐步调整。
      </p>
      <Field label="学年名称">
        <Input aria-label="学年名称" aria-invalid={hit('name') || undefined} placeholder="如 2027-2028学年" maxLength={20}
          value={year.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="开学日期">
          <Input aria-label="开学日期" type="date" aria-invalid={hit('start_date') || undefined}
            value={year.start_date} onChange={(e) => onChange({ start_date: e.target.value })} />
        </Field>
        <Field label="结束日期">
          <Input aria-label="结束日期" type="date" aria-invalid={hit('end_date') || undefined}
            value={year.end_date} onChange={(e) => onChange({ end_date: e.target.value })} />
        </Field>
      </div>
      {problem?.section === 'new_year' && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
      {year.start_date !== '' && year.end_date !== '' && year.start_date >= year.end_date && (
        <p className="text-sm text-destructive">结束日期须晚于开学日期</p>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={!ready || busy} onClick={onSuggest}>生成建议</Button>
        {hasPlan && <span className="text-sm text-muted-foreground">已有草稿方案,重新生成会覆盖它</span>}
      </div>
    </div>
  )
}
