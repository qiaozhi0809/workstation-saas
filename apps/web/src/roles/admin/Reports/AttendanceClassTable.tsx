import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import type { AttendanceCounts, AttendanceReport } from '@/shared/types/admin'
import { NO_PERM_ATTENDANCE, isForbidden } from './forbidden'

const fmtRate = (r: number | null): string => (r === null ? '—' : `${(r * 100).toFixed(1)}%`)

const COLS = 8
const th = 'whitespace-nowrap px-3 py-2 text-right font-medium'
const td = 'px-3 py-2 text-right tabular-nums'

function CountCells({ c }: { c: AttendanceCounts }) {
  return (
    <>
      <td className={td}>{c.days}</td>
      <td className={td}>{c.expected}</td>
      <td className={td}>{c.present}</td>
      <td className={td}>{c.leave}</td>
      <td className={td}>{c.absent}</td>
      <td className={td}>{c.late}</td>
      <td className={td}>{fmtRate(c.rate)}</td>
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
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="px-3 py-1 text-left font-medium">姓名</th>
          <th className="px-3 py-1 text-left font-medium">学号</th>
          <th className={th}>请假</th>
          <th className={th}>缺勤</th>
          <th className={th}>迟到</th>
        </tr>
      </thead>
      <tbody>
        {q.data.students.map((s) => (
          <tr key={s.student_id} className="border-t border-border/60">
            <td className="px-3 py-1.5">{s.name}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{s.student_no ?? '—'}</td>
            <td className={td}>{s.leave}</td>
            <td className={td}>{s.absent}</td>
            <td className={td}>{s.late}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">班级</th>
            <th className={th}>记录天数</th>
            <th className={th}>应到</th>
            <th className={th}>出勤</th>
            <th className={th}>请假</th>
            <th className={th}>缺勤</th>
            <th className={th}>迟到</th>
            <th className={th}>出勤率</th>
          </tr>
        </thead>
        <tbody>
          {report.classes.map((c) => {
            const expanded = open === c.class_id
            const Icon = expanded ? ChevronDown : ChevronRight
            return (
              <Fragment key={c.class_id}>
                <tr className="border-t">
                  {/* 班名不折行:375 宽下由外层容器横向滚动,而不是把班名挤成竖排(L58) */}
                  <td className="whitespace-nowrap px-3 py-2 text-left">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : c.class_id)}
                      className="flex items-center gap-1 rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon
                        className="h-4 w-4 shrink-0 text-muted-foreground print:hidden"
                        aria-hidden="true"
                      />
                      {c.class_name}
                    </button>
                  </td>
                  <CountCells c={c} />
                </tr>
                {expanded && (
                  <tr className="bg-muted/30">
                    <td colSpan={COLS} className="px-3 py-2">
                      <ClassDetail month={month} classId={c.class_id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          <tr className="border-t-2 bg-muted/50 font-semibold">
            <td className="px-3 py-2 text-left">合计</td>
            <CountCells c={report.total} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
