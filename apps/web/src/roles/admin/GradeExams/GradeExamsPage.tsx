import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { todayIn, useSchoolTz } from '@/shared/hooks/useSchoolTz'
import type { GradeExam } from '@/shared/types/admin'
import ConfirmBox from '../Org/ConfirmBox'
import { errMsg } from '../Org/errMsg'
import GradeExamForm from './GradeExamForm'
import { invalidateTeacherExamCaches } from './teacherCache'

type Dialog = { kind: 'form'; exam?: GradeExam } | { kind: 'delete'; exam: GradeExam }
function Progress({ c }: { c: GradeExam['classes'][number] }) {
  const pct = c.expected > 0 ? Math.min(100, Math.round((c.entered / c.expected) * 100)) : 0
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-28 shrink-0">{`${c.class_name} ${c.entered}/${c.expected}`}</span>
      <span
        role="progressbar"
        aria-label={`${c.class_name} 录分进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
    </li>
  )
}

function ExamRow({
  exam,
  onEdit,
  onDelete,
}: {
  exam: GradeExam
  onEdit(): void
  onDelete(): void
}) {
  const qc = useQueryClient()
  const sync = useMutation({
    mutationFn: () => adminApi.syncGradeExam(exam.id),
    onSuccess: (saved) => {
      toast('已补建')
      void qc.invalidateQueries({ queryKey: ['grade-exams'] })
      void qc.invalidateQueries({ queryKey: ['report', 'scores'] })
      invalidateTeacherExamCaches(qc, saved.classes)
    },
    onError: (e) => toast(errMsg(e)),
  })
  return (
    <li aria-label={exam.name} className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{exam.name}</h3>
        <Badge variant="neutral">{exam.exam_type}</Badge>
        <span className="text-sm text-muted-foreground">{exam.date}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/reports/scores?exam=${encodeURIComponent(exam.id)}`}>查看汇总</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            编辑
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{exam.subjects.map((s) => s.name).join('、')}</p>
      {exam.missing_classes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <span>{`有 ${exam.missing_classes.length} 个班还没有这场考试`}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            补建
          </Button>
        </div>
      )}
      <ul aria-label="各班录分进度" className="grid gap-1.5">
        {exam.classes.map((c) => (
          <Progress key={c.class_id} c={c} />
        ))}
      </ul>
    </li>
  )
}

export default function GradeExamsPage() {
  const qc = useQueryClient()
  // 年级列表读只读的 GET /school/grades(school.view 即可,按调用者可见年级裁剪;L272);
  // /admin/grades 需要 org.manage,年级组长会 403
  const grades = useQuery({
    queryKey: ['admin', 'grades', 'school'], // 挂在 ['admin','grades'] 下,改年级 / 升级的失效一并覆盖
    queryFn: adminApi.schoolGrades,
  })
  // 新建联考的默认日期按学校时区算"今天"(L41 / L43)
  const school = useSchoolTz()
  const [sel, setSel] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [delError, setDelError] = useState<string | null>(null)

  const list = grades.data ?? []
  const grade = (sel && list.find((g) => g.id === sel)) || list[0] || null
  const gradeId = grade?.id ?? null
  const gradeName = grade?.name ?? ''
  const exams = useQuery({
    queryKey: ['grade-exams', gradeId],
    queryFn: () => adminApi.gradeExams(gradeId),
    enabled: gradeId !== null,
  })

  const close = () => {
    setDialog(null)
    setDelError(null)
  }
  const remove = useMutation({
    mutationFn: (exam: GradeExam) => adminApi.deleteGradeExam(exam.id),
    onSuccess: (_, exam) => {
      close()
      void qc.invalidateQueries({ queryKey: ['grade-exams'] })
      void qc.invalidateQueries({ queryKey: ['report', 'scores'] })
      invalidateTeacherExamCaches(qc, exam.classes)
    },
    onError: (e) => setDelError(errMsg(e)),
  })

  if (grades.isError)
    return (
      <ErrorState
        title="加载失败"
        onRetry={() => void grades.refetch()}
        retrying={grades.isFetching}
        className="p-6"
      />
    )
  if (!grades.data || !school.ready) return <LoadingState />

  let body
  if (gradeId === null) body = <EmptyState title="还没有年级" />
  else if (exams.isError) {
    body = (
      <ErrorState
        title="联考加载失败"
        onRetry={() => void exams.refetch()}
        retrying={exams.isFetching}
      />
    )
  } else if (!exams.data) body = <LoadingState />
  else if (exams.data.length === 0) body = <EmptyState title={`${gradeName}还没有联考`} />
  else {
    body = (
      <ul aria-label="联考列表" className="grid gap-3">
        {exams.data.map((x) => (
          <ExamRow
            key={x.id}
            exam={x}
            onEdit={() => setDialog({ kind: 'form', exam: x })}
            onDelete={() => {
              setDelError(null)
              setDialog({ kind: 'delete', exam: x })
            }}
          />
        ))}
      </ul>
    )
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">年级联考</h1>
        <Button
          className="ml-auto"
          disabled={gradeId === null}
          onClick={() => setDialog({ kind: 'form' })}
        >
          新建联考
        </Button>
      </header>
      {list.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <SegmentedTabs
            label="年级"
            variant="underline"
            value={gradeId ?? ''}
            items={list.map((g) => ({ value: g.id, label: g.name }))}
            onChange={setSel}
          />
        </div>
      )}
      {body}
      {dialog?.kind === 'form' && grade && (
        <GradeExamForm
          gradeId={grade.id}
          // 学段直接用年级简项的 effective_stage,不再按年级名推断(L234)
          stage={grade.effective_stage}
          exam={dialog.exam}
          today={todayIn(school.tz)}
          onClose={close}
          onSaved={close}
        />
      )}
      <ConfirmBox
        open={dialog?.kind === 'delete'}
        title="删除联考"
        confirmLabel="确认删除"
        error={delError}
        busy={remove.isPending}
        onClose={close}
        onConfirm={() => dialog?.kind === 'delete' && remove.mutate(dialog.exam)}
      >
        <p>
          {dialog?.kind === 'delete'
            ? `删除「${dialog.exam.name}」及各班的这场考试?已录入分数的联考不能删除。`
            : ''}
        </p>
      </ConfirmBox>
    </div>
  )
}
