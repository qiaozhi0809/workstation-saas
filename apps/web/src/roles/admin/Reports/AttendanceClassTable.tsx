import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { Button } from '@/shared/components/ui/button'
import {
  Table,
  TableBody,
  TableFoot,
  TableHead,
  TableRow,
  Td,
  Th,
} from '@/shared/components/ui/table'
import type { AttendanceCounts, AttendanceReport } from '@/shared/types/admin'
import { NO_PERM_ATTENDANCE, isForbidden } from './forbidden'

const fmtRate = (r: number | null): string => (r === null ? '—' : `${(r * 100).toFixed(1)}%`)

const COLS = 8

function CountCells({ c }: { c: AttendanceCounts }) {
  return (
    <>
      <Td numeric>{c.days}</Td>
      <Td numeric>{c.expected}</Td>
      <Td numeric>{c.present}</Td>
      <Td numeric>{c.leave}</Td>
      <Td numeric>{c.absent}</Td>
      <Td numeric>{c.late}</Td>
      <Td numeric>{fmtRate(c.rate)}</Td>
    </>
  )
}

function ClassDetail({ month, classId }: { month: string; classId: string }) {
  const q = useQuery({
    queryKey: ['report', 'attendance', month, classId],
    queryFn: () => adminApi.attendanceClass(month, classId),
  })
  if (isForbidden(q.error)) return <EmptyState title={NO_PERM_ATTENDANCE} className="py-2" />
  if (q.isError)
    return (
      <ErrorState
        title="学生明细加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  if (!q.data)
    return (
      <p className="py-2 text-sm text-muted-foreground" role="status">
        加载中…
      </p>
    )
  if (q.data.students.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">本月该班没有学生记录</p>
  return (
    <Table density="compact" containerClassName="w-full bg-transparent shadow-none">
      <TableHead>
        <TableRow>
          <Th>姓名</Th>
          <Th>学号</Th>
          <Th numeric>请假</Th>
          <Th numeric>缺勤</Th>
          <Th numeric>迟到</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {q.data.students.map((s) => (
          <TableRow key={s.student_id}>
            <Td>{s.name}</Td>
            <Td className="text-muted-foreground">{s.student_no ?? '—'}</Td>
            <Td numeric>{s.leave}</Td>
            <Td numeric>{s.absent}</Td>
            <Td numeric>{s.late}</Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function AttendanceClassTable({
  month,
  report,
}: {
  month: string
  report: AttendanceReport
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Table minWidth={640} containerClassName="w-fit max-w-full">
      <TableHead>
        <TableRow className="bg-muted/50">
          <Th>班级</Th>
          <Th numeric>记录天数</Th>
          <Th numeric>应到</Th>
          <Th numeric>出勤</Th>
          <Th numeric>请假</Th>
          <Th numeric>缺勤</Th>
          <Th numeric>迟到</Th>
          <Th numeric>出勤率</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {report.classes.map((c) => {
          const expanded = open === c.class_id
          const Icon = expanded ? ChevronDown : ChevronRight
          return (
            <Fragment key={c.class_id}>
              <TableRow>
                {/* 班名不折行:375 宽下由外层容器横向滚动,而不是把班名挤成竖排(L58) */}
                <Td>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : c.class_id)}
                    className="-ml-3 gap-1 font-medium"
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-muted-foreground print:hidden"
                      aria-hidden="true"
                    />
                    {c.class_name}
                  </Button>
                </Td>
                <CountCells c={c} />
              </TableRow>
              {expanded && (
                <TableRow className="h-auto bg-muted/30">
                  <Td colSpan={COLS} nowrap={false} className="py-2">
                    <ClassDetail month={month} classId={c.class_id} />
                  </Td>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
      <TableFoot>
        <TableRow className="bg-muted/50">
          <Td>合计</Td>
          <CountCells c={report.total} />
        </TableRow>
      </TableFoot>
    </Table>
  )
}
