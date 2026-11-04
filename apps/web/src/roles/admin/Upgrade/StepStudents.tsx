import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/shared/api/students'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import { rowHit } from './errors'
import { repeatTargets, targetKey } from './planOps'
import type { StepProps } from './StepClasses'

type Mode = 'follow' | 'repeat' | 'leave'

export default function StepStudents({ plan, edit, problem, classId, onClassChange, onMark, gradeOf, markedClass }: Pick<StepProps, 'plan' | 'edit' | 'problem'> & {
  classId: string | null
  onClassChange(id: string): void
  onMark(enrollmentId: string, classId: string): void
  gradeOf(classId: string): string | null
  /** 标了例外的学生 enrollment_id → 他所在的旧班 */
  markedClass: Record<string, string>
}) {
  const current = classId && plan.classes.some((c) => c.from_class_id === classId) ? classId : (plan.classes[0]?.from_class_id ?? null)
  const list = useQuery({
    queryKey: ['upgrade', 'students', current],
    queryFn: () => studentsApi.listInClass(current!),
    enabled: current !== null,
  })
  if (current === null) return <p className="text-sm text-muted-foreground">当前学年没有进行中的班级</p>
  const grade = gradeOf(current)
  const targets = repeatTargets(plan, grade)
  // 方案里有、当前班名单里没有的例外行(且不属于别的班):否则用户看不见也删不掉
  const listed = new Set((list.data?.items ?? []).map((x) => x.enrollment_id))
  const orphans = list.data
    ? plan.students.map((s, i) => ({ s, i })).filter(({ s }) => !listed.has(s.enrollment_id) && (markedClass[s.enrollment_id] ?? current) === current)
    : []
  const find = (eid: string) => plan.students.findIndex((s) => s.enrollment_id === eid)

  const setMode = (eid: string, name: string, mode: Mode) => {
    onMark(eid, current)
    edit((pl) => {
      const rest = pl.students.filter((s) => s.enrollment_id !== eid)
      if (mode === 'follow') return { ...pl, students: rest }
      if (mode === 'leave') return { ...pl, students: [...rest, { enrollment_id: eid, name, action: 'leave', to: null }] }
      const first = repeatTargets(pl, grade)[0]
      return { ...pl, students: [...rest, { enrollment_id: eid, name, action: 'repeat', to: first?.to ?? null }] }
    })
  }
  const setTarget = (eid: string, key: string) => {
    const t = targets.find((x) => x.key === key)
    if (t) edit((pl) => ({ ...pl, students: pl.students.map((s) => (s.enrollment_id === eid ? { ...s, to: t.to } : s)) }))
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">默认所有学生随班升级。这里只标出例外:留级(重读本年级)或离校。已标记 {plan.students.length} 人。</p>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">班级</span>
        <NativeSelect aria-label="选择班级" value={current} onChange={(e) => onClassChange(e.target.value)}>
          {plan.classes.map((c) => <option key={c.from_class_id} value={c.from_class_id}>{c.from_name ?? c.from_class_id}</option>)}
        </NativeSelect>
        {grade && <span className="text-muted-foreground">{grade}</span>}
      </label>
      {problem?.section === 'students' && <p className="text-sm text-destructive">{problem.message}</p>}
      {targets.length === 0 && <p className="text-sm text-muted-foreground">没有同年级的目标班,暂时不能标留级;可先在"新建班级"里添加。</p>}
      {list.isLoading && <LoadingState />}
      {list.isError && <ErrorState title="学生加载失败" onRetry={() => void list.refetch()} />}
      <ul className="grid gap-1">
        {(list.data?.items ?? []).map((s) => {
          const i = find(s.enrollment_id)
          const row = i >= 0 ? plan.students[i] : null
          const mode: Mode = row ? row.action : 'follow'
          const key = row?.action === 'repeat' ? targetKey(row.to) : ''
          const staleTarget = row?.action === 'repeat' && !targets.some((x) => x.key === key)
          const bad = (i >= 0 && rowHit(problem, 'students', i)) || staleTarget
          return (
            <li key={s.enrollment_id} data-invalid={bad || undefined}
              className={cn('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2', bad && 'border-destructive')}>
              <span className="min-w-20 text-sm font-medium">{s.name}</span>
              <NativeSelect aria-label={`${s.name} 去向`} aria-invalid={bad || undefined} value={mode}
                onChange={(e) => setMode(s.enrollment_id, s.name, e.target.value as Mode)}>
                <option value="follow">随班</option>
                <option value="repeat" disabled={targets.length === 0}>留级</option>
                <option value="leave">离校</option>
              </NativeSelect>
              {mode === 'repeat' && (
                <NativeSelect aria-label={`${s.name} 留级目标`} aria-invalid={bad || undefined} value={key}
                  onChange={(e) => setTarget(s.enrollment_id, e.target.value)}>
                  {!targets.some((t) => t.key === key) && <option value={key}>目标已失效,请重新选择</option>}
                  {targets.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </NativeSelect>
              )}
            </li>
          )
        })}
      </ul>
      {orphans.length > 0 && (
        <section className="grid gap-1" aria-label="不在当前名单中的例外">
          <h3 className="text-sm font-medium">不在当前名单中的例外</h3>
          <p className="text-xs text-muted-foreground">这些学生已不在上面的名单里(如已转班或退学),可能让方案校验失败,请移除或核对。</p>
          <ul className="grid gap-1">
            {orphans.map(({ s, i }) => {
              const label = s.name ?? s.enrollment_id.slice(0, 8)
              const bad = rowHit(problem, 'students', i)
              return (
                <li key={s.enrollment_id} data-invalid={bad || undefined}
                  className={cn('flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm', bad && 'border-destructive')}>
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground">{s.action === 'repeat' ? '留级' : '离校'}</span>
                  <Button variant="ghost" size="sm" aria-label={`移除 ${label}`}
                    onClick={() => edit((pl) => ({ ...pl, students: pl.students.filter((x) => x.enrollment_id !== s.enrollment_id) }))}>移除</Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
