import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ScoreClassTable, { type ScoreView } from './ScoreClassTable'
import ScoreStudentTable from './ScoreStudentTable'

const VIEWS: readonly { value: ScoreView; label: string }[] = [
  { value: 'avg', label: '平均分' },
  { value: 'pass', label: '及格率' },
  { value: 'good', label: '优秀率' },
]

/** 服务端文件名拿不到(接口只返回 Blob),由页面自己起名并触发下载 */
function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 等浏览器开始处理下载再释放
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function StudentSection({
  examId,
  classId,
  className,
  subjects,
}: {
  examId: string
  classId: string
  className: string
  subjects: string[]
}) {
  const q = useQuery({
    queryKey: ['report', 'scores', examId, classId],
    queryFn: () => adminApi.scoreStudents(examId, classId),
  })
  if (q.isError)
    return (
      <ErrorState
        title="学生成绩加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  if (!q.data) return <LoadingState />
  return (
    <ScoreStudentTable label={`${className} 学生成绩`} subjects={subjects} rows={q.data.students} />
  )
}

export default function ScoresReportPage() {
  const [params] = useSearchParams()
  const exams = useQuery({
    queryKey: ['grade-exams', null],
    queryFn: () => adminApi.gradeExams(null),
  })
  const [sel, setSel] = useState<string | null>(null)
  const [view, setView] = useState<ScoreView>('avg')
  const [openClass, setOpenClass] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const list = exams.data ?? []
  // 列表按日期倒序,默认最近一场;?exam= 来自联考页的"查看汇总"
  const examId =
    [sel, params.get('exam')].find((id) => id && list.some((x) => x.id === id)) ??
    list[0]?.id ??
    null
  const current = list.find((x) => x.id === examId)

  const summary = useQuery({
    queryKey: ['report', 'scores', examId],
    queryFn: () => adminApi.scoreReport(examId!),
    enabled: examId !== null,
  })

  const exportCsv = async () => {
    if (!examId || !current) return
    setExporting(true)
    try {
      saveBlob(`${current.name}-成绩汇总.csv`, await adminApi.exportScoreReport(examId))
    } catch {
      toast('导出失败,请重试')
    } finally {
      setExporting(false)
    }
  }

  if (exams.isError)
    return (
      <ErrorState
        title="加载失败"
        onRetry={() => void exams.refetch()}
        retrying={exams.isFetching}
        className="p-6"
      />
    )
  if (!exams.data) return <LoadingState />

  let body
  if (list.length === 0)
    body = <EmptyState title="还没有年级联考" description="先在“年级联考”里创建一场联考" />
  else if (summary.isError) {
    body = (
      <ErrorState
        title="成绩汇总加载失败"
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
      />
    )
  } else if (!summary.data) body = <LoadingState />
  else if (summary.data.classes.length === 0) {
    body = (
      <EmptyState
        title="暂无班级考试"
        description="这场联考还没有关联的班级考试,可在“年级联考”里同步班级"
      />
    )
  } else {
    const s = summary.data
    const open = s.classes.find((c) => c.class_id === openClass)
    body = (
      <>
        <SegmentedTabs<ScoreView> label="指标" items={VIEWS} value={view} onChange={setView} />
        <ScoreClassTable
          summary={s}
          view={view}
          openClassId={open?.class_id ?? null}
          onToggle={(id) => setOpenClass((cur) => (cur === id ? null : id))}
        />
        {open && examId && (
          <section aria-label={`${open.class_name} 学生`} className="flex min-w-0 flex-col gap-2">
            <h2 className="text-base font-semibold">{open.class_name}</h2>
            <StudentSection
              key={open.class_id}
              examId={examId}
              classId={open.class_id}
              className={open.class_name}
              subjects={s.subjects.map((x) => x.name)}
            />
          </section>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="text-lg font-semibold">成绩汇总</h1>
        {list.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">选择联考</span>
            <NativeSelect
              value={examId ?? ''}
              className="max-w-full"
              onChange={(e) => {
                setSel(e.target.value)
                setOpenClass(null)
              }}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>{`${x.name}(${x.grade_name} ${x.date})`}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        <Button
          className="ml-auto"
          variant="outline"
          disabled={!current || exporting || summary.data?.classes.length === 0}
          onClick={() => void exportCsv()}
        >
          导出 CSV
        </Button>
      </header>
      {body}
    </div>
  )
}
