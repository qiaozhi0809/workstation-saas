import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react'
import { examsApi } from '@/shared/api/exams'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { downloadText } from '@/shared/lib/csv'
import { examTable, latestExam, previousExam, rankChanges } from '@/shared/lib/grades'
import { cn } from '@/shared/lib/utils'
import type { StudentRecord } from '@/shared/types/student'
import ClassGate, { type ClassContext } from '../ClassGate'
import { useStudentDrawer } from '../StudentProfile/useStudentDrawer'
import { rosterCsv } from './exportRoster'
import { buildRows, filterRows, sortRows, type RosterFilter, type RosterRow, type RosterSort } from './rosterView'

const FILTERS: { value: RosterFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'cadre', label: '班干部' },
  { value: 'focus', label: '重点关注' },
  { value: 'boarding', label: '住校' },
  { value: 'birthday', label: '本月生日' },
  { value: 'unseated', label: '未排座' },
]

const MAX_TAGS = 3

export default function StudentsPage() {
  return <ClassGate title="学生">{(ctx) => <Roster ctx={ctx} />}</ClassGate>
}

function Roster({ ctx: { cls, summary, perms } }: { ctx: ClassContext }) {
  const classId = cls.id
  const today = summary.today
  const canReview = perms.includes('review.read')
  const canExam = perms.includes('exam.read')
  const canExport = perms.includes('student.export')

  const records = useQuery({ queryKey: ['student-records', classId], queryFn: () => studentsApi.records(classId) })
  const review = useQuery({
    queryKey: ['review-summary', classId], queryFn: () => reviewsApi.summary(classId), enabled: canReview,
  })
  const gradebook = useQuery({
    queryKey: ['gradebook', classId], queryFn: () => examsApi.gradebook(classId), enabled: canExam,
  })

  const items = records.data?.items
  const points = useMemo(
    () => (canReview ? new Map((review.data?.items ?? []).map((i) => [i.enrollment_id, i.total])) : null),
    [canReview, review.data],
  )
  const ranks = useMemo(() => {
    const map = new Map<string, { rank: number | null; change: number | null }>()
    const book = gradebook.data?.exams
    const latest = book ? latestExam(book) : null
    if (!items || !book || !latest) return map
    const ids = items.map((r) => r.enrollment_id)
    const cur = examTable(latest, ids)
    const prevExam = previousExam(book, latest.id)
    const changes = rankChanges(cur, prevExam ? examTable(prevExam, ids) : null)
    for (const r of cur) map.set(r.id, { rank: r.rank, change: changes.get(r.id) ?? null })
    return map
  }, [items, gradebook.data])

  const rows = useMemo(() => (items ? buildRows(items, ranks, points, today) : []), [items, ranks, points, today])

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [sort, setSort] = useState<RosterSort>('no')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const drawer = useStudentDrawer()

  if (records.isLoading) return <LoadingState />
  if (!items) {
    return <ErrorState title="学生名单加载失败" onRetry={() => void records.refetch()} retrying={records.isFetching} />
  }
  if (items.length === 0) return <EmptyState title="还没有学生" />

  const showContacts = items.some((r) => 'contacts' in r)
  const visible = sortRows(filterRows(rows, q, filter, today), sort, dir)

  const toggleSort = (next: RosterSort) => {
    if (next === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setDir(next === 'points' ? 'desc' : 'asc') }
  }

  const sortProps = { sort, dir, onSort: toggleSort }

  const exportRoster = async () => {
    setExporting(true)
    setExportError(false)
    try {
      const res = await studentsApi.exportRecords(classId)
      downloadText(`${cls.name}-学生名单.csv`, rosterCsv(res.items, points))
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search" aria-label="搜索学生" placeholder="姓名 / 学号 / 标签" className="pl-8"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {exportError && <span role="alert" className="text-sm text-destructive">导出失败,请重试</span>}
          {canExport && (
            <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportRoster()}>
              <Download aria-hidden="true" className="mr-1 h-4 w-4" />导出名单
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <SegmentedTabs<RosterFilter> label="筛选" items={FILTERS} value={filter} onChange={setFilter} />
      </div>
      {visible.length === 0 ? (
        <EmptyState title="没有符合条件的学生" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <SortHead by="no" {...sortProps}>学号</SortHead>
                <SortHead by="name" {...sortProps}>姓名</SortHead>
                <Head>性别</Head>
                <Head>座位</Head>
                <Head>职务</Head>
                <SortHead by="birthday" {...sortProps}>生日</SortHead>
                {showContacts && <Head>主要联系人</Head>}
                <Head>标签</Head>
                {canExam && <SortHead by="rank" {...sortProps}>排名</SortHead>}
                {canReview && <SortHead by="points" {...sortProps}>积分</SortHead>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <StudentRow
                  key={r.enrollment_id} row={r} showContacts={showContacts} canExam={canExam} canReview={canReview}
                  onOpen={() => drawer.open(r.student_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SortHead({ by, sort, dir, onSort, children }: {
  by: RosterSort; sort: RosterSort; dir: 'asc' | 'desc'; onSort(by: RosterSort): void; children: string
}) {
  return (
    <th scope="col" aria-sort={sort === by ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-3 py-2 text-left font-medium">
      <button type="button" onClick={() => onSort(by)} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        {sort === by && (dir === 'asc' ? <ArrowUp aria-hidden="true" className="h-3 w-3" /> : <ArrowDown aria-hidden="true" className="h-3 w-3" />)}
      </button>
    </th>
  )
}

function Head({ children }: { children: string }) {
  return <th scope="col" className="px-3 py-2 text-left font-medium">{children}</th>
}

function seatText(r: StudentRecord): string {
  return r.seat_row !== null && r.seat_col !== null ? `${r.seat_row}排${r.seat_col}列` : '—'
}

function StudentRow({ row: r, showContacts, canExam, canReview, onOpen }: {
  row: RosterRow; showContacts: boolean; canExam: boolean; canReview: boolean; onOpen(): void
}) {
  const contact = r.contacts?.[0]
  const tags = r.tags ?? []
  return (
    <tr className="cursor-pointer border-t hover:bg-muted/50" onClick={onOpen}>
      <td className="px-3 py-2">{r.student_no ?? '—'}</td>
      <td className="px-3 py-2 font-medium">
        <button type="button" className="text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={(e) => { e.stopPropagation(); onOpen() }}>{r.name}</button>
      </td>
      <td className="px-3 py-2">{r.gender ?? '—'}</td>
      <td className="px-3 py-2">{seatText(r)}</td>
      <td className="px-3 py-2">{r.class_role ?? '—'}</td>
      <td className="px-3 py-2">
        {r.birthdate ? (
          <span {...(r.daysToBirthday === 0 ? { 'data-birthday-today': true } : {})} className={cn(r.daysToBirthday === 0 && 'font-medium text-destructive')}>
            {r.birthdate}{r.daysToBirthday === 0 && ' 今天生日'}
          </span>
        ) : '—'}
      </td>
      {showContacts && <td className="px-3 py-2">{contact ? `${contact.name} ${contact.phone}` : '—'}</td>}
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, MAX_TAGS).map((t) => <Badge key={t} variant="neutral">{t}</Badge>)}
          {tags.length > MAX_TAGS && <Badge variant="outline">{`+${tags.length - MAX_TAGS}`}</Badge>}
        </div>
      </td>
      {canExam && (
        <td className="px-3 py-2">
          {r.rank === null ? '—' : (
            <span className="inline-flex items-center gap-1">
              <span data-testid="rank">{r.rank}</span>
              {r.rankChange !== null && r.rankChange !== 0 && (
                <span className={cn('text-xs', r.rankChange > 0 ? 'text-success' : 'text-destructive')}>
                  {r.rankChange > 0 ? `↑${r.rankChange}` : `↓${-r.rankChange}`}
                </span>
              )}
            </span>
          )}
        </td>
      )}
      {canReview && <td className="px-3 py-2">{r.points ?? '—'}</td>}
    </tr>
  )
}
