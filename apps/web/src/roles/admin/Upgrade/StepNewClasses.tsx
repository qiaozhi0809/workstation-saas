import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { UpgradeNewClassPlan } from '@/shared/types/admin'
import { fieldHit, rowHit } from './errors'
import { newClassRow, removeNewClass } from './planOps'
import PersonSelect, { UNKNOWN } from './PersonSelect'
import type { StepProps } from './StepClasses'

const num = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

export default function StepNewClasses({ plan, edit, problem, nameOf, remember }: StepProps) {
  const patch = (i: number, p: Partial<UpgradeNewClassPlan>) =>
    edit((pl) => ({ ...pl, new_classes: pl.new_classes.map((n, j) => (j === i ? { ...n, ...p } : n)) }))
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">新学年里需要额外新建的班级(如新生入学的一年级)。没有就直接下一步。</p>
      <ul className="grid gap-3">
        {plan.new_classes.map((n, i) => {
          const k = `新建班${i + 1}`
          const bad = rowHit(problem, 'new_classes', i)
          const hit = (f: string) => fieldHit(problem, 'new_classes', i, f) || undefined
          const tid = n.homeroom_teacher_id ?? null
          return (
            <li key={i} data-invalid={bad || undefined}
              className={cn('grid gap-2 rounded-md border p-3', bad && 'border-destructive')}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{k}</span>
                <Button variant="ghost" size="sm" aria-label={`删除${k}`}
                  onClick={() => edit((pl) => removeNewClass(pl, i))}>删除</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label={`${k} 年级名`} placeholder="年级名" value={n.grade_name} aria-invalid={hit('grade_name')}
                  onChange={(e) => patch(i, { grade_name: e.target.value })} />
                <Input aria-label={`${k} 班名`} placeholder="班名" value={n.name} aria-invalid={hit('name')}
                  onChange={(e) => patch(i, { name: e.target.value })} />
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">班主任</span>
                  <PersonSelect label={`${k} 班主任`} emptyText="选择班主任" invalid={!!hit('homeroom_teacher_id')}
                    selected={tid ? [{ id: tid, name: nameOf(tid) ?? UNKNOWN }] : []}
                    onChange={(next) => {
                      const p = next[0]
                      if (p) remember({ [p.id]: p.name })
                      patch(i, { homeroom_teacher_id: p?.id ?? null })
                    }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <label className="grid gap-1"><span className="text-muted-foreground">每桌人数</span>
                  <NativeSelect aria-label={`${k} 每桌人数`} aria-invalid={hit('desk_size')} value={n.desk_size}
                    onChange={(e) => patch(i, { desk_size: num(e.target.value) as UpgradeNewClassPlan['desk_size'] })}>
                    <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </NativeSelect>
                </label>
                <label className="grid gap-1"><span className="text-muted-foreground">行数</span>
                  <Input aria-label={`${k} 行数`} type="number" min={1} max={12} value={n.seat_rows} aria-invalid={hit('seat_rows')}
                    onChange={(e) => patch(i, { seat_rows: num(e.target.value) })} />
                </label>
                <label className="grid gap-1"><span className="text-muted-foreground">列数</span>
                  <Input aria-label={`${k} 列数`} type="number" min={1} max={12} value={n.seat_cols} aria-invalid={hit('seat_cols')}
                    onChange={(e) => patch(i, { seat_cols: num(e.target.value) })} />
                </label>
                <label className="grid gap-1"><span className="text-muted-foreground">座位方式</span>
                  <NativeSelect aria-label={`${k} 座位方式`} aria-invalid={hit('seat_layout')} value={n.seat_layout}
                    onChange={(e) => patch(i, { seat_layout: e.target.value as UpgradeNewClassPlan['seat_layout'] })}>
                    <option value="auto">自动排座</option><option value="manual">手动排座</option>
                  </NativeSelect>
                </label>
              </div>
              {bad && problem && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
            </li>
          )
        })}
      </ul>
      <div><Button variant="outline" onClick={() => edit((pl) => ({ ...pl, new_classes: [...pl.new_classes, newClassRow()] }))}>新增班级</Button></div>
    </div>
  )
}
