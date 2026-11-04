import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { UpgradeNewClassPlan } from '@/shared/types/admin'
import { fieldHit, rowHit } from './errors'
import { newClassRow, removeNewClass } from './planOps'
import PersonSelect, { UNKNOWN } from './PersonSelect'
import type { StepProps } from './StepClasses'

/** 每桌人数对应的每排座位数规则;不符合时返回提示文字,符合返回 null */
function colsHint(desk: number, cols: number): string | null {
  if (desk === 3) return cols >= 3 && cols <= 12 && cols % 3 === 0 ? null : '每排座位数需为 3 到 12 之间 3 的倍数'
  if (desk === 2) return cols >= 2 && cols <= 12 && cols % 2 === 0 ? null : '每排座位数需为 2 到 12 之间的偶数'
  return cols >= 2 && cols <= 12 ? null : '每排座位数需为 2 到 12'
}

const num = (v: string) => {
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? 0 : n
}

/** 数字输入:编辑中允许暂时为空;只有合法数字才写进方案,失焦后恢复成方案里的值 */
function NumInput({ label, value, min = 1, invalid, onCommit }: { label: string; value: number; min?: number; invalid?: boolean; onCommit(n: number): void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <Input aria-label={label} type="number" min={min} max={12} aria-invalid={invalid || undefined} value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value)
        if (/^\d+$/.test(e.target.value)) onCommit(parseInt(e.target.value, 10))
      }}
      onBlur={() => setText(null)} />
  )
}

export default function StepNewClasses({ plan, edit, problem, nameOf, remember }: StepProps) {
  const [removedNote, setRemovedNote] = useState<string | null>(null)
  const patch = (i: number, p: Partial<UpgradeNewClassPlan>) =>
    edit((pl) => ({ ...pl, new_classes: pl.new_classes.map((n, j) => (j === i ? { ...n, ...p } : n)) }))
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">新学年里需要额外新建的班级(如新生入学的一年级)。没有就直接下一步。</p>
      {removedNote && <p role="status" className="text-sm text-muted-foreground">{removedNote}</p>}
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
                  onClick={() => {
                    const n = plan.students.filter((x) => x.to?.new_class === i).length
                    setRemovedNote(n > 0 ? `${n} 名学生的留级标记已一并移除` : null)
                    edit((pl) => removeNewClass(pl, i))
                  }}>删除</Button>
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
                  <NumInput label={`${k} 行数`} value={n.seat_rows} invalid={!!hit('seat_rows')} onCommit={(v) => patch(i, { seat_rows: v })} />
                </label>
                <label className="grid gap-1"><span className="text-muted-foreground">列数</span>
                  <NumInput label={`${k} 列数`} min={2} value={n.seat_cols} invalid={!!hit('seat_cols')} onCommit={(v) => patch(i, { seat_cols: v })} />
                </label>
                <label className="grid gap-1"><span className="text-muted-foreground">座位方式</span>
                  <NativeSelect aria-label={`${k} 座位方式`} aria-invalid={hit('seat_layout')} value={n.seat_layout}
                    onChange={(e) => patch(i, { seat_layout: e.target.value as UpgradeNewClassPlan['seat_layout'] })}>
                    <option value="auto">自动排座</option><option value="manual">手动排座</option>
                  </NativeSelect>
                </label>
              </div>
              {colsHint(n.desk_size, n.seat_cols) && <p className="text-sm text-warning">{colsHint(n.desk_size, n.seat_cols)}</p>}
              {bad && problem && <p className="text-sm text-destructive">{problem.message}</p>}
            </li>
          )
        })}
      </ul>
      <div><Button variant="outline" onClick={() => { setRemovedNote(null); edit((pl) => ({ ...pl, new_classes: [...pl.new_classes, newClassRow()] })) }}>新增班级</Button></div>
    </div>
  )
}
