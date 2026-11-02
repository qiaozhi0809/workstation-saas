import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import ClassGate, { type ClassContext } from '../ClassGate'
import ExamForm from './ExamForm'
import ExamList from './ExamList'

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

  const select = (id: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (id) next.set('exam', id)
    else next.delete('exam')
    return next
  }, { replace: true })

  if (exams.isLoading) return <LoadingState />
  if (!exams.data) {
    return <ErrorState title="考试加载失败" onRetry={() => void exams.refetch()} retrying={exams.isFetching} />
  }

  const items = exams.data.items
  const current = items.find((x) => x.id === params.get('exam')) ?? items[0]
  const canEdit = canWrite && !!current && (canAllSubjects || current.created_by_me)

  const modal = form && (
    <ExamForm
      classId={cls.id}
      exam={form === 'edit' ? current : undefined}
      today={summary.today}
      mySubjects={subjects}
      canAllSubjects={canAllSubjects}
      onClose={() => setForm(null)}
      onSaved={(saved) => { setForm(null); select(saved.id) }}
      onDeleted={() => { setForm(null); select(null) }}
    />
  )

  if (items.length === 0) {
    return (
      <>
        <EmptyState title="还没有考试"
          action={canWrite ? <Button onClick={() => setForm('new')}>新建考试</Button> : undefined} />
        {modal}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
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
        <section aria-label="当前考试" className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{current.name}</h2>
            <Badge variant="neutral">{current.exam_type}</Badge>
            <span className="text-sm text-muted-foreground">{current.date}</span>
            {canEdit && (
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => setForm('edit')}>编辑考试</Button>
            )}
          </header>
          {/* Task 12:成绩表格放在这里 */}
          <div data-slot="score-grid" />
        </section>
      </div>
      {modal}
    </div>
  )
}
