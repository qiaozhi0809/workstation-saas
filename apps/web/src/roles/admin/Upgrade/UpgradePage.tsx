import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import ConfirmBox from '../Org/ConfirmBox'
import { errMsg } from '../Org/errMsg'
import { isStale, problemOf, stepOfSection, type Problem, type StepKey } from './errors'
import { refreshYearData } from './invalidate'
import { normalizePlan, syncGradeHeads, toRequest } from './planOps'
import StepClasses from './StepClasses'
import StepNewClasses from './StepNewClasses'
import StepPeople from './StepPeople'
import StepPreview from './StepPreview'
import StepStudents from './StepStudents'
import StepYear from './StepYear'
import UpgradeLatestCard from './UpgradeLatestCard'
import { STEPS, useUpgradeDraft } from './useUpgradeDraft'

export default function UpgradePage() {
  const qc = useQueryClient()
  const d = useUpgradeDraft()
  const { draft } = d
  const { plan, step } = draft
  const [problem, setProblem] = useState<Problem | null>(null)
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [askRegen, setAskRegen] = useState(false)
  const [askDiscard, setAskDiscard] = useState(false)

  const classes = useQuery({ queryKey: ['admin', 'classes', null], queryFn: () => adminApi.classes(), enabled: plan !== null })
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles, enabled: plan !== null })
  const gradeOf = (id: string) => classes.data?.find((c) => c.id === id)?.grade_name ?? null
  const headNames = new Map((roles.data ?? []).filter((r) => r.role === 'grade_head').map((r) => [r.user_id, r.display_name]))
  const nameOf = (id: string | null | undefined) => (id ? (draft.ui.names[id] ?? headNames.get(id) ?? null) : null)

  const goto = (s: StepKey) => { setNotice(null); d.setStep(s) }

  /** 方案问题 / 过期当场处理并返回 true;其他错误交还调用方 */
  const handleError = (e: unknown): boolean => {
    const p = problemOf(e)
    if (p) {
      setProblem(p); setStale(false); setNotice(null)
      if (p.section) {
        d.setStep(stepOfSection(p.section))
        if (p.section === 'students' && p.index !== null && plan) {
          const eid = toRequest(plan).students[p.index]?.enrollment_id
          const cid = eid ? draft.ui.studentClasses[eid] : undefined
          if (cid) d.setUi({ studentClassId: cid })
        }
      }
      return true
    }
    if (isStale(e)) { setStale(true); setProblem(null); setNotice(null); return true }
    return false
  }

  const suggest = useMutation({
    mutationFn: () => adminApi.upgradeSuggest({
      name: draft.year.name.trim(), start_date: draft.year.start_date, end_date: draft.year.end_date,
    }),
    onSuccess: (raw) => {
      const next = syncGradeHeads(normalizePlan(raw))
      const names: Record<string, string> = {}
      next.classes.forEach((c) => { if (c.homeroom_teacher_id && c.teacher_name) names[c.homeroom_teacher_id] = c.teacher_name })
      d.setPlan(next)
      d.setUi({ studentClassId: null, studentClasses: {} })
      d.rememberNames(names)
      d.setStep('classes')
      setProblem(null); setStale(false); setNotice(null); setDone(false)
    },
    onError: (e) => { if (!handleError(e)) setNotice(errMsg(e)) },
  })
  const regenerate = () => { setAskRegen(false); suggest.mutate() }

  const edit = (fn: Parameters<typeof d.editPlan>[0]) => { setProblem(null); d.editPlan(fn) }
  const applied = () => {
    d.clear()
    setProblem(null); setStale(false); setNotice(null); setDone(true)
    void refreshYearData(qc)
  }

  const idx = STEPS.findIndex((s) => s.key === step)
  const stepProps = plan && { plan, edit, problem, nameOf, remember: d.rememberNames }

  return (
    <div className="grid gap-4 p-4">
      <h1 className="text-xl font-semibold">学年升级</h1>
      <UpgradeLatestCard />
      {done && <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">升级已执行,新学年已生效</p>}
      <nav aria-label="升级步骤">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <Button variant={s.key === step ? 'default' : 'outline'} size="sm" aria-current={s.key === step ? 'step' : undefined}
                disabled={s.key !== 'year' && plan === null} onClick={() => goto(s.key)}>
                {i + 1}. {s.label}
              </Button>
            </li>
          ))}
        </ol>
      </nav>
      {stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          <span>方案已过期,请重新生成</span>
          <Button size="sm" variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate()}>重新生成</Button>
        </div>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">方案校验未通过,请修改标红的位置{problem.section === null ? `:${problem.message}` : ''}</p>}
      {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
      <Card>
        <CardContent className={cn('pt-6')}>
          {step === 'year' && (
            <StepYear year={draft.year} hasPlan={plan !== null} busy={suggest.isPending} problem={problem}
              onChange={d.setYear} onSuggest={() => (plan ? setAskRegen(true) : suggest.mutate())} />
          )}
          {stepProps && step === 'classes' && <StepClasses {...stepProps} gradeOf={gradeOf} />}
          {stepProps && step === 'students' && (
            <StepStudents plan={stepProps.plan} edit={edit} problem={problem} gradeOf={gradeOf}
              classId={draft.ui.studentClassId} onClassChange={(id) => d.setUi({ studentClassId: id })}
              onMark={(eid, cid) => d.setUi({ studentClasses: { ...draft.ui.studentClasses, [eid]: cid } })} />
          )}
          {stepProps && step === 'newClasses' && <StepNewClasses {...stepProps} />}
          {stepProps && step === 'people' && <StepPeople {...stepProps} />}
          {plan && step === 'preview' && <StepPreview plan={plan} onApplied={applied} onError={handleError} />}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={idx <= 0} onClick={() => goto(STEPS[idx - 1].key)}>上一步</Button>
        <Button variant="outline" disabled={plan === null || idx >= STEPS.length - 1} onClick={() => goto(STEPS[idx + 1].key)}>下一步</Button>
        <Button variant="ghost" className="ml-auto" disabled={plan === null && draft.year.name === ''} onClick={() => setAskDiscard(true)}>放弃草稿</Button>
      </div>
      <ConfirmBox open={askRegen} title="重新生成建议" confirmLabel="覆盖并重新生成" onConfirm={regenerate} onClose={() => setAskRegen(false)}>
        <p>重新生成会覆盖当前草稿里的所有改动</p>
      </ConfirmBox>
      <ConfirmBox open={askDiscard} title="放弃草稿" confirmLabel="确认放弃"
        onConfirm={() => { d.clear(); setProblem(null); setStale(false); setNotice(null); setAskDiscard(false) }}
        onClose={() => setAskDiscard(false)}>
        <p>草稿方案将被清除,无法恢复</p>
      </ConfirmBox>
    </div>
  )
}
