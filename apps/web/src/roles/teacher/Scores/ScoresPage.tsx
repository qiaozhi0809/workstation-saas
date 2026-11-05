import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { Exam } from '@/shared/types/grades'
import ClassGate, { type ClassContext } from '../ClassGate'
import ExamForm, { GRADE_EXAM_MANAGED } from './ExamForm'
import { exportScores } from './exportScores'
import ExamList, { GRADE_EXAM_LABEL } from './ExamList'
import HeaderImport from './HeaderImport'
import ScoreGrid from './ScoreGrid'
import { useScoreAutosave, type SaveStatus } from './useScoreAutosave'

export default function ScoresPage() {
  return (
    <ClassGate title="成绩录入" need="exam.read">
      {(ctx) => <ScoresBody ctx={ctx} />}
    </ClassGate>
  )
}

function ScoresBody({ ctx }: { ctx: ClassContext }) {
  const { cls, summary, perms, subjects } = ctx
  const [params, setParams] = useSearchParams()
  const [form, setForm] = useState<'new' | 'edit' | null>(null)
  const exams = useQuery({ queryKey: ['exams', cls.id], queryFn: () => examsApi.list(cls.id) })

  const canWrite = perms.includes('exam.write')
  const canAllSubjects = cls.role !== 'subject_teacher'

  const select = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('exam', id)
        else next.delete('exam')
        return next
      },
      { replace: true },
    )

  if (exams.isLoading) return <LoadingState />
  if (!exams.data) {
    return (
      <ErrorState
        title="考试加载失败"
        onRetry={() => void exams.refetch()}
        retrying={exams.isFetching}
      />
    )
  }

  const items = exams.data.items
  const current = items.find((x) => x.id === params.get('exam')) ?? items[0]
  const canEdit =
    canWrite && !!current && !current.grade_exam_id && (canAllSubjects || current.created_by_me)

  const modal = form && (
    <ExamForm
      classId={cls.id}
      exam={form === 'edit' ? current : undefined}
      today={summary.today}
      mySubjects={subjects}
      canAllSubjects={canAllSubjects}
      onClose={() => setForm(null)}
      onSaved={(saved) => {
        setForm(null)
        select(saved.id)
      }}
      onDeleted={() => {
        setForm(null)
        select(null)
      }}
    />
  )

  if (items.length === 0) {
    return (
      <>
        <EmptyState
          title="还没有考试"
          action={canWrite ? <Button onClick={() => setForm('new')}>新建考试</Button> : undefined}
        />
        {modal}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setForm('new')}>新建考试</Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ≥ lg 是左栏列表;窄屏同一组件渲染成顶部的下拉选择 */}
        <aside>
          <ExamList exams={items} currentId={current.id} onSelect={select} />
        </aside>
        <ExamSection
          key={current.id}
          ctx={ctx}
          exam={current}
          onEdit={canEdit ? () => setForm('edit') : undefined}
        />
      </div>
      {modal}
    </div>
  )
}

const STATUS_TEXT: Record<Exclude<SaveStatus, 'idle'>, string> = {
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
}

function ExamSection({
  ctx,
  exam,
  onEdit,
}: {
  ctx: ClassContext
  exam: Exam
  onEdit?: () => void
}) {
  const { cls, perms, subjects } = ctx
  const sheet = useQuery({
    queryKey: ['score-sheet', cls.id, exam.id],
    queryFn: () => examsApi.sheet(cls.id, exam.id),
  })
  const roster = useQuery({
    queryKey: ['class-students', cls.id],
    queryFn: () => studentsApi.listInClass(cls.id),
  })
  const [importing, setImporting] = useState(false)
  const save = useScoreAutosave({ classId: cls.id, examId: exam.id })

  const writable = perms.includes('score.write')
    ? cls.role !== 'subject_teacher'
      ? null
      : subjects
    : []

  const canImport = writable === null || writable.length > 0
  const canExport = perms.includes('score.export')

  let body
  if (sheet.isLoading || roster.isLoading) body = <LoadingState />
  else if (!sheet.data || !roster.data) {
    body = (
      <ErrorState
        title="成绩加载失败"
        retrying={sheet.isFetching || roster.isFetching}
        onRetry={() => {
          void sheet.refetch()
          void roster.refetch()
        }}
      />
    )
  } else {
    body = (
      <ScoreGrid
        exam={sheet.data.exam}
        roster={roster.data.items}
        sheet={sheet.data}
        writable={writable}
        onCells={save.queue}
        onDiscard={save.discard}
      />
    )
  }

  return (
    <section aria-label="当前考试" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{exam.name}</h2>
        <Badge variant="neutral">{exam.exam_type}</Badge>
        {exam.grade_exam_id && <Badge variant="info">{GRADE_EXAM_LABEL}</Badge>}
        <span className="text-sm text-muted-foreground">{exam.date}</span>
        {exam.grade_exam_id && (
          <span className="text-sm text-muted-foreground">{GRADE_EXAM_MANAGED}</span>
        )}
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          {save.status !== 'idle' && <span>{STATUS_TEXT[save.status]}</span>}
          {save.status === 'error' && (
            <Button variant="outline" size="sm" onClick={save.retry}>
              重试
            </Button>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canImport && (
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              按表头导入
            </Button>
          )}
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              disabled={!roster.data}
              onClick={() => void exportScores(cls.id, cls.name, exam, roster.data?.items ?? [])}
            >
              导出
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/teacher/analysis?exam=${encodeURIComponent(exam.id)}`}>看分析</Link>
          </Button>
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              编辑考试
            </Button>
          )}
        </div>
      </header>
      {body}
      {importing && sheet.data && roster.data && (
        <HeaderImport
          classId={cls.id}
          exam={sheet.data.exam}
          roster={roster.data.items}
          writable={writable}
          onClose={() => setImporting(false)}
          onImported={() => setImporting(false)}
        />
      )}
    </section>
  )
}
