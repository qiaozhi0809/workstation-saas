import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
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
  if (!q.data) return <LoadingState variant="table" />
  if (q.data.students.length === 0) return <EmptyState title="这个班没有学生记录" />
  return (
    <Table aria-label="名单" minWidth={320}>
      <TableHead>
        <TableRow className="bg-muted/50">
          <Th>学号</Th>
          <Th>姓名</Th>
          <Th>状态</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {q.data.students.map((s) => (
          <TableRow key={s.student_id}>
            <Td>{dash(s.student_no)}</Td>
            <Td>{s.name}</Td>
            <Td>{enrollmentStatusText(s.status)}</Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  if (!q.data) return <LoadingState variant="table" />
  const { exam, students } = q.data
  return (
    <Table aria-label="成绩表" minWidth={512}>
      <TableHead>
        <TableRow className="bg-muted/50">
          <Th>学号</Th>
          <Th>姓名</Th>
          {exam.subjects.map((s) => (
            <Th key={s.name} numeric>{`${s.name} /${s.full}`}</Th>
          ))}
          <Th numeric>总分</Th>
          <Th numeric>班级名次</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {students.map((s) => (
          <TableRow key={s.student_id}>
            <Td>{dash(s.student_no)}</Td>
            <Td>{s.name}</Td>
            {exam.subjects.map((sub) => (
              <Td key={sub.name} numeric>
                {dash(s.scores[sub.name])}
              </Td>
            ))}
            <Td numeric>{dash(s.total)}</Td>
            <Td numeric>{dash(s.class_rank)}</Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    <div className="flex flex-col gap-6">
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

/**
 * 没带 ?year= 直接打开(书签 / 手输地址),或带的学年已不存在(404,如升级被回滚)时,
 * 按班 id 一次 GET /admin/history/classes/{id} 定位学年与班名(L275);不存在 404 → 标题退化为"往年班级"
 */
function useLocateClass(classId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['history', 'class', classId],
    queryFn: () => adminApi.historyClass(classId),
    enabled,
  })
}

export default function HistoryClassPage() {
  const id = useParams().id ?? ''
  const paramYear = useSearchParams()[0].get('year') ?? ''
  const [tab, setTab] = useState<Tab>('roster')
  // 标题用的学年名 / 班名复用列表页的缓存(直接打开链接时才会真发请求);失败或查不到就退化为"往年班级"
  const years = useQuery({
    queryKey: ['history', 'years'],
    queryFn: () => adminApi.historyYears(),
    enabled: paramYear !== '',
  })
  const classes = useQuery({
    queryKey: ['history', 'classes', paramYear],
    queryFn: () => adminApi.historyClasses(paramYear),
    enabled: paramYear !== '',
  })
  const yearGone =
    classes.isError && classes.error instanceof ApiError && classes.error.status === 404
  const fromList = paramYear !== '' && !yearGone
  const located = useLocateClass(id, !fromList)
  const yearId = fromList ? paramYear : (located.data?.year_id ?? '')
  const yearName = fromList
    ? years.data?.find((y) => y.id === paramYear)?.name
    : located.data?.year_name
  const className = fromList
    ? classes.data?.find((c) => c.class_id === id)?.class_name
    : located.data?.class_name
  const title = yearName && className ? `${yearName} ${className}` : '往年班级'

  return (
    <PageContainer width="default">
      <PageHeader
        title={title}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link
                to={yearId ? `/admin/history?year=${encodeURIComponent(yearId)}` : '/admin/history'}
              >
                ← 往年班级
              </Link>
            </Button>
            <SegmentedTabs<Tab> label="内容" size="sm" value={tab} onChange={setTab} items={TABS} />
          </>
        }
      />
      {tab === 'roster' ? <RosterTab key={id} classId={id} /> : <ScoresTab key={id} classId={id} />}
    </PageContainer>
  )
}
