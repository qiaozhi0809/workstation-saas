import { gradeNames, setGradeHead } from './planOps'
import PersonSelect, { UNKNOWN } from './PersonSelect'
import { rowHit } from './errors'
import type { StepProps } from './StepClasses'
import { cn } from '@/shared/lib/utils'

export default function StepPeople({ plan, edit, problem, nameOf, remember }: StepProps) {
  const grades = gradeNames(plan)
  if (grades.length === 0) return <p className="text-sm text-muted-foreground">新学年还没有年级,请先在"班级去向"里填写新年级名</p>
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        每个新年级可以设置一位或多位年级组长。{plan.grade_heads == null && '尚未编辑时按"跟届"规则沿用原年级组长;改动任何一行后以这里的名单为准。'}
      </p>
      <ul className="grid gap-2">
        {grades.map((g) => {
          const ids = plan.grade_heads?.find((h) => h.grade_name === g)?.user_ids ?? []
          // 后端的 index 指向发出的(已与年级对齐的)数组,即 gradeNames 的顺序
          const bad = Array.isArray(plan.grade_heads) && rowHit(problem, 'grade_heads', grades.indexOf(g))
          return (
            <li key={g} data-invalid={bad || undefined}
              className={cn('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2', bad && 'border-destructive')}>
              <span className="min-w-24 text-sm font-medium">{g}</span>
              <span className="text-sm text-muted-foreground">年级组长</span>
              <PersonSelect multiple label={`${g} 年级组长`} emptyText="添加" invalid={bad}
                selected={ids.map((id) => ({ id, name: nameOf(id) ?? UNKNOWN }))}
                onChange={(next) => {
                  remember(Object.fromEntries(next.filter((p) => p.name !== UNKNOWN).map((p) => [p.id, p.name])))
                  edit((pl) => setGradeHead(pl, g, next.map((p) => p.id)))
                }} />
              {bad && problem && <p role="alert" className="w-full text-sm text-destructive">{problem.message}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
