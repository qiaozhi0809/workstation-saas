import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { enrollmentStatusText } from './statusText'

type Tab = 'roster' | 'scores'
const TABS: { value: Tab; label: string }[] = [
  { value: 'roster', label: '名单' },
  { value: 'scores', label: '成绩' },
]

const NO_PERM = '没有权限查看往年班级'
const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403
const dash = (v: string | number | null | undefined) => v ?? '—'

function RosterTab({ classId }: { classId: string }) {
  const q = useQuery({
    queryKey: ['history', 'students', classId],
    queryFn: () => adminApi.historyStudents(classId),
  })
  if (q.isError) {
    return isForbidden(q.error) ? (
      <EmptyState title={NO_PERM} />
    ) : (
      <ErrorState title="名单加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
    )
  }
  if (!q.data) return <LoadingState />
  if (q.data.students.length === 0) return <EmptyState title="这个班没有学生记录" />
  return (
    <div className="overflow-x-auto">
      <table aria-label="名单" className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">学号</th>
            <th className="py-2 pr-3 font-medium">姓名</th>
            <th className="py-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {q.data.students.map((s) => (
            <tr key={s.student_id} className="border-b">
              <td className="py-2 pr-3">{dash(s.student_no)}</td>
              <td className="py-2 pr-3">{s.name}</td>
              <td className="py-2">{enrollmentStatusText(s.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScoresTable({ examId }: { examId: string }) {
  const q = useQuery({
    queryKey: ['history', 'scores', examId],
    queryFn: () => adminApi.historyScores(examId),
  })
  if (q.isError) {
    return isForbidden(q.error) ? (
      <EmptyState title={NO_PERM} />
    ) : (
      <ErrorState title="成绩加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
    )
  }
  if (!q.data) return <LoadingState />
  const { exam, students } = q.data
  return (
    <div className="overflow-x-auto">
      <table aria-label="成绩表" className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">学号</th>
            <th className="py-2 pr-3 font-medium">姓名</th>
            {exam.subjects.map((s) => (
              <th key={s.name} className="py-2 pr-3 font-medium">{`${s.name} /${s.full}`}</th>
            ))}
            <th className="py-2 pr-3 font-medium">总分</th>
            <th className="py-2 font-medium">班级名次</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.student_id} className="border-b">
              <td className="py-2 pr-3">{dash(s.student_no)}</td>
              <td className="py-2 pr-3">{s.name}</td>
              {exam.subjects.map((sub) => (
                <td key={sub.name} className="py-2 pr-3">
                  {dash(s.scores[sub.name])}
                </td>
              ))}
              <td className="py-2 pr-3">{dash(s.total)}</td>
              <td className="py-2">{dash(s.class_rank)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScoresTab({ classId }: { classId: string }) {
  const [picked, setPicked] = useState<string | null>(null)
  const exams = useQuery({
    queryKey: ['history', 'exams', classId],
    queryFn: () => adminApi.historyExams(classId),
  })
  if (exams.isError) {
    return isForbidden(exams.error) ? (
      <EmptyState title={NO_PERM} />
    ) : (
      <ErrorState
        title="考试加载失败"
        onRetry={() => void exams.refetch()}
        retrying={exams.isFetching}
      />
    )
  }
  if (!exams.data) return <LoadingState />
  if (exams.data.length === 0) return <EmptyState title="这个班没有考试记录" />
  // 接口按日期倒序,默认第一场即最近一场
  const examId = picked ?? exams.data[0].id
  return (
    <div className="flex flex-col gap-3">
      <NativeSelect
        aria-label="考试"
        className="w-fit max-w-full"
        value={examId}
        onChange={(e) => setPicked(e.target.value)}
      >
        {exams.data.map((e) => (
          <option key={e.id} value={e.id}>{`${e.name}(${e.date})`}</option>
        ))}
      </NativeSelect>
      <ScoresTable examId={examId} />
    </div>
  )
}

export default function HistoryClassPage() {
  const id = useParams().id ?? ''
  const yearId = useSearchParams()[0].get('year') ?? ''
  const [tab, setTab] = useState<Tab>('roster')
  // 标题用的学年名 / 班名复用列表页的缓存(直接打开链接时才会真发请求);失败或查不到就退化为"往年班级"
  const years = useQuery({ queryKey: ['history', 'years'], queryFn: () => adminApi.historyYears() })
  const classes = useQuery({
    queryKey: ['history', 'classes', yearId],
    queryFn: () => adminApi.historyClasses(yearId),
    enabled: yearId !== '',
  })
  const yearName = years.data?.find((y) => y.id === yearId)?.name
  const className = classes.data?.find((c) => c.class_id === id)?.class_name
  const title = yearName && className ? `${yearName} ${className}` : '往年班级'

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Link
            to={yearId ? `/admin/history?year=${encodeURIComponent(yearId)}` : '/admin/history'}
            className="w-fit rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ← 往年班级
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <SegmentedTabs<Tab>
          label="内容"
          className="w-fit"
          value={tab}
          onChange={setTab}
          items={TABS}
        />
      </header>
      {tab === 'roster' ? <RosterTab key={id} classId={id} /> : <ScoresTab key={id} classId={id} />}
    </div>
  )
}
