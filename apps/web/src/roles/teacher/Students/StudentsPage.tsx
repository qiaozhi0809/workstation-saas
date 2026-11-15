import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Download, Search, Upload, UserPlus } from 'lucide-react'
import { examsApi } from '@/shared/api/exams'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { downloadText } from '@/shared/lib/csv'
import { examTable, latestExam, previousExam, rankChanges } from '@/shared/lib/grades'
import { gridOf, seatText as cellText, type DeskGrid } from '@/shared/lib/seats'
import { cn } from '@/shared/lib/utils'
import type { StudentRecord } from '@/shared/types/student'
import ClassGate, { type ClassContext } from '../ClassGate'
import { useStudentDrawer } from '../StudentProfile/useStudentDrawer'
import { rosterCsv } from './exportRoster'
import ImportDialog from './ImportDialog'
import {
  buildRows,
  filterRows,
  sortRows,
  type RosterFilter,
  type RosterRow,
  type RosterSort,
} from './rosterView'
import StudentForm from './StudentForm'

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
  return (
    <ClassGate title="学生" titleMode="none">
      {(ctx) => <Roster ctx={ctx} />}
    </ClassGate>
  )
}

function Roster({ ctx: { cls, summary, perms } }: { ctx: ClassContext }) {
  const classId = cls.id
  const today = summary.today
  const canReview = perms.includes('review.read')
  const canExam = perms.includes('exam.read')
  const canExport = perms.includes('student.export')
  const canManage = perms.includes('student.manage')

  const records = useQuery({
    queryKey: ['student-records', classId],
    queryFn: () => studentsApi.records(classId),
  })
  const review = useQuery({
    queryKey: ['review-summary', classId],
    queryFn: () => reviewsApi.summary(classId),
    enabled: canReview,
  })
  const gradebook = useQuery({
    queryKey: ['gradebook', classId],
    queryFn: () => examsApi.gradebook(classId),
    enabled: canExam,
  })

  const items = records.data?.items
  const points = useMemo(
    // 积分汇总未加载好(或失败)时为 null:显示 —、导出留空,而不是误显示 0
    () =>
      canReview && review.data
        ? new Map(review.data.items.map((i) => [i.enrollment_id, i.total]))
        : null,
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

  const rows = useMemo(
    () => (items ? buildRows(items, ranks, points, today) : []),
    [items, ranks, points, today],
  )

  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [sort, setSort] = useState<RosterSort>('no')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const narrow = useNarrow()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [editor, setEditor] = useState<{ record?: StudentRecord } | null>(null)
  const [importing, setImporting] = useState(false)
  const drawer = useStudentDrawer()
  // 班级设置里"去添加 / 去导入"跳来的:打开对应对话框,并清掉参数免得刷新后重复弹出
  const [params, setParams] = useSearchParams()
  const action = params.get('action')
  useEffect(() => {
    if (action !== 'add' && action !== 'import') return
    if (canManage) {
      if (action === 'add') setEditor({})
      else setImporting(true)
    }
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.delete('action')
        return out
      },
      { replace: true },
    )
  }, [action, canManage, setParams])

  if (records.isLoading) {
    return (
      <PageContainer className="min-w-0">
        <PageHeader title="学生" />
        <LoadingState variant="table" />
      </PageContainer>
    )
  }
  if (!items) {
    return (
      <PageContainer className="min-w-0">
        <PageHeader title="学生" />
        <ErrorState
          title="学生名单加载失败"
          onRetry={() => void records.refetch()}
          retrying={records.isFetching}
        />
      </PageContainer>
    )
  }
  const dialogs = (
    <>
      {editor && (
        <StudentForm
          cls={cls}
          record={editor.record}
          roster={items}
          onClose={() => setEditor(null)}
        />
      )}
      {importing && <ImportDialog cls={cls} onClose={() => setImporting(false)} />}
    </>
  )
  const importButton = canManage && (
    <Button type="button" variant="outline" onClick={() => setImporting(true)}>
      <Upload aria-hidden="true" className="mr-1 h-4 w-4" />
      批量导入
    </Button>
  )
  const addButton = canManage && (
    <Button type="button" onClick={() => setEditor({})}>
      <UserPlus aria-hidden="true" className="mr-1 h-4 w-4" />
      添加学生
    </Button>
  )
  if (items.length === 0) {
    return (
      <PageContainer className="min-w-0">
        <PageHeader title="学生" />
        <EmptyState
          title="还没有学生"
          action={
            canManage ? (
              <div className="flex gap-2">
                {addButton}
                {importButton}
              </div>
            ) : undefined
          }
        />
        {dialogs}
      </PageContainer>
    )
  }

  const grid = gridOf(cls)
  // 整列为空就不占位:没有任何人有联系人 / 标签时不渲染这两列
  const showContacts = !narrow && items.some((r) => (r.contacts?.length ?? 0) > 0)
  const showTags = !narrow && items.some((r) => (r.tags?.length ?? 0) > 0)
  const visible = sortRows(filterRows(rows, q, filter, today), sort, dir)

  const toggleSort = (next: RosterSort) => {
    if (next === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(next)
      setDir(next === 'points' ? 'desc' : 'asc')
    }
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
    <PageContainer className="min-w-0">
      <PageHeader
        title="学生"
        actions={
          <>
            {exportError && (
              <span role="alert" className="text-sm text-destructive">
                导出失败,请重试
              </span>
            )}
            {canExport && (
              <Button
                type="button"
                variant="outline"
                disabled={exporting}
                onClick={() => void exportRoster()}
              >
                <Download aria-hidden="true" className="mr-1 h-4 w-4" />
                导出名单
              </Button>
            )}
            {importButton}
            {addButton}
          </>
        }
      />
      <div className="flex flex-col gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜索学生"
            placeholder="姓名 / 学号 / 标签"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <div className="w-max whitespace-nowrap">
            <SegmentedTabs<RosterFilter>
              label="筛选"
              items={FILTERS}
              value={filter}
              onChange={(v) => setFilter(v)}
            />
          </div>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="没有符合条件的学生" />
      ) : (
        <Table containerClassName="relative">
          <TableHead className="bg-muted/50">
            <TableRow>
              <SortHead by="no" {...sortProps}>
                学号
              </SortHead>
              <SortHead by="name" {...sortProps}>
                姓名
              </SortHead>
              <Th>性别</Th>
              <Th>座位</Th>
              <Th>职务</Th>
              <SortHead by="birthday" {...sortProps}>
                生日
              </SortHead>
              {showContacts && <Th>主要联系人</Th>}
              {showTags && <Th>标签</Th>}
              {canExam && (
                <SortHead by="rank" numeric {...sortProps}>
                  排名
                </SortHead>
              )}
              {canReview && (
                <SortHead by="points" numeric {...sortProps}>
                  积分
                </SortHead>
              )}
              {canManage && (
                <Th align="end">
                  <span className="sr-only">操作</span>
                </Th>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((r) => (
              <StudentRow
                key={r.enrollment_id}
                row={r}
                grid={grid}
                showContacts={showContacts}
                showTags={showTags}
                canExam={canExam}
                canReview={canReview}
                canManage={canManage}
                onOpen={() => drawer.open(r.student_id)}
                onEdit={() => setEditor({ record: r })}
              />
            ))}
          </TableBody>
        </Table>
      )}
      {dialogs}
    </PageContainer>
  )
}

function SortHead({
  by,
  sort,
  dir,
  onSort,
  numeric,
  children,
}: {
  by: RosterSort
  sort: RosterSort
  dir: 'asc' | 'desc'
  onSort(by: RosterSort): void
  numeric?: boolean
  children: string
}) {
  return (
    <Th
      numeric={numeric}
      aria-sort={sort === by ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {/* 按钮自带 12 的内边距,用负外边距让文字与单元格内容同一条边 */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(by)}
        className={cn('gap-1 px-3 text-xs font-medium', numeric ? '-mr-3' : '-ml-3')}
      >
        {children}
        {sort === by &&
          (dir === 'asc' ? (
            <ArrowUp aria-hidden="true" className="h-3 w-3" />
          ) : (
            <ArrowDown aria-hidden="true" className="h-3 w-3" />
          ))}
      </Button>
    </Th>
  )
}

function seatText(r: StudentRecord, grid: DeskGrid): string {
  return r.seat_row !== null && r.seat_col !== null
    ? cellText({ row: r.seat_row, col: r.seat_col }, grid)
    : '—'
}

const NARROW = '(max-width: 639px)'

/** 手机宽度(375)下隐藏次要列,其余靠表格自己横向滚动。 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(NARROW)
    const on = () => setNarrow(mql.matches)
    on()
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return narrow
}

function StudentRow({
  row: r,
  grid,
  showContacts,
  showTags,
  canExam,
  canReview,
  canManage,
  onOpen,
  onEdit,
}: {
  row: RosterRow
  grid: DeskGrid
  showContacts: boolean
  showTags: boolean
  canExam: boolean
  canReview: boolean
  canManage: boolean
  onOpen(): void
  onEdit(): void
}) {
  const contact = r.contacts?.[0]
  const tags = r.tags ?? []
  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onOpen}>
      <Td>{r.student_no ?? '—'}</Td>
      <Td className="font-medium">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="touch-target px-0 font-medium text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          {r.name}
        </Button>
      </Td>
      <Td>{r.gender ?? '—'}</Td>
      <Td>{seatText(r, grid)}</Td>
      <Td>{r.class_role ?? '—'}</Td>
      <Td>
        {r.birthdate ? (
          <span
            {...(r.daysToBirthday === 0 ? { 'data-birthday-today': true } : {})}
            className={cn(r.daysToBirthday === 0 && 'font-medium text-warning')}
          >
            {r.birthdate}
            {r.daysToBirthday === 0 && ' 今天生日'}
          </span>
        ) : (
          '—'
        )}
      </Td>
      {showContacts && <Td>{contact ? `${contact.name} ${contact.phone}` : '—'}</Td>}
      {showTags && (
        <Td nowrap={false} className="min-w-[8rem]">
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, MAX_TAGS).map((t) => (
              <Badge key={t} variant="neutral">
                {t}
              </Badge>
            ))}
            {tags.length > MAX_TAGS && (
              <Badge variant="outline">{`+${tags.length - MAX_TAGS}`}</Badge>
            )}
          </div>
        </Td>
      )}
      {canExam && (
        <Td numeric>
          {r.rank === null ? (
            '—'
          ) : (
            <span className="inline-flex items-center gap-1">
              <span data-testid="rank">{r.rank}</span>
              {r.rankChange !== null && r.rankChange !== 0 && (
                <span
                  className={cn('text-xs', r.rankChange > 0 ? 'text-success' : 'text-destructive')}
                >
                  {r.rankChange > 0 ? `↑${r.rankChange}` : `↓${-r.rankChange}`}
                </span>
              )}
            </span>
          )}
        </Td>
      )}
      {canReview && <Td numeric>{r.points ?? '—'}</Td>}
      {canManage && (
        <Td align="end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="touch-target"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            编辑
          </Button>
        </Td>
      )}
    </TableRow>
  )
}
