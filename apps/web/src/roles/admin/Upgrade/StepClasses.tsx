import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { UpgradeClassPlan, UpgradePlan } from '@/shared/types/admin'
import { fieldHit, rowHit, type Problem } from './errors'
import PersonSelect, { UNKNOWN } from './PersonSelect'

export interface StepProps {
  plan: UpgradePlan
  edit(fn: (p: UpgradePlan) => UpgradePlan): void
  problem: Problem | null
  nameOf(id: string | null | undefined): string | null
  remember(names: Record<string, string>): void
}

export default function StepClasses({ plan, edit, problem, nameOf, remember, gradeOf }: StepProps & {
  gradeOf(classId: string): string | null
}) {
  const patch = (i: number, p: Partial<UpgradeClassPlan>) =>
    edit((pl) => ({ ...pl, classes: pl.classes.map((c, j) => (j === i ? { ...c, ...p } : c)) }))
  if (plan.classes.length === 0) return <p className="text-sm text-muted-foreground">当前学年没有进行中的班级</p>
  return (
    <ul className="grid gap-3">
      {plan.classes.map((c, i) => {
        const name = c.from_name ?? '(未命名班级)'
        const grade = gradeOf(c.from_class_id)
        const bad = rowHit(problem, 'classes', i)
        const promote = c.action === 'promote'
        const teacherId = c.homeroom_teacher_id ?? null
        const teacher = teacherId ? (c.teacher_name ?? nameOf(teacherId) ?? UNKNOWN) : null
        return (
          <li key={c.from_class_id} data-invalid={bad || undefined}
            className={cn('grid gap-2 rounded-md border p-3', bad && 'border-destructive')}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{name}</span>
              {grade && <span className="text-sm text-muted-foreground">{grade}</span>}
              <NativeSelect aria-label={`${name} 去向`} aria-invalid={fieldHit(problem, 'classes', i, 'action') || undefined}
                value={c.action} onChange={(e) => patch(i, { action: e.target.value as UpgradeClassPlan['action'] })}>
                <option value="promote">升级</option>
                <option value="graduate">毕业</option>
              </NativeSelect>
            </div>
            {promote ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label={`${name} 新年级名`} placeholder="新年级名" value={c.to_grade_name ?? ''}
                  aria-invalid={fieldHit(problem, 'classes', i, 'to_grade_name') || undefined}
                  onChange={(e) => patch(i, { to_grade_name: e.target.value })} />
                <Input aria-label={`${name} 新班名`} placeholder="新班名" value={c.to_name ?? ''}
                  aria-invalid={fieldHit(problem, 'classes', i, 'to_name') || undefined}
                  onChange={(e) => patch(i, { to_name: e.target.value })} />
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">班主任</span>
                  <PersonSelect label={`${name} 班主任`} emptyText="选择班主任"
                    invalid={fieldHit(problem, 'classes', i, 'homeroom_teacher_id')}
                    selected={teacherId ? [{ id: teacherId, name: teacher ?? '' }] : []}
                    onChange={(next) => {
                      const p = next[0]
                      if (p) remember({ [p.id]: p.name })
                      // 选人接口只给 user_id:直接写入,由后端归一成 teachers.id
                      patch(i, { homeroom_teacher_id: p?.id ?? null, teacher_name: p?.name ?? null })
                    }} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`${name} 保留任课老师`} checked={c.keep_teachers}
                    onChange={(e) => patch(i, { keep_teachers: e.target.checked })} />
                  保留任课老师
                </label>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">这个班毕业,学生不再进入新学年</p>
            )}
            {bad && problem && <p className="text-sm text-destructive">{problem.message}</p>}
          </li>
        )
      })}
    </ul>
  )
}
