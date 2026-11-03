import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type { BoardClass } from '@/shared/types/admin'
import { attendanceViews, signed } from './attendanceViews'

export default function ClassCard({ cls, gradeId }: { cls: BoardClass; gradeId: string | null }) {
  const views = useMemo(() => attendanceViews(cls.attendance), [cls.attendance])
  const podium = useMemo(() => ({ left: cls.podium_left, right: cls.podium_right }), [cls.podium_left, cls.podium_right])
  const m = cls.metrics
  const to = `/admin/classes/${encodeURIComponent(cls.id)}${gradeId ? `?grade=${encodeURIComponent(gradeId)}` : ''}`
  const meta = [cls.room, cls.homeroom_name ? `班主任 ${cls.homeroom_name}` : null].filter(Boolean).join(' · ')
  return (
    <article data-class-card
      className="relative flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground focus-within:ring-2 focus-within:ring-ring hover:bg-accent/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            <Link to={to} className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none">{cls.name}</Link>
          </h2>
          {meta && <p className="truncate text-sm text-muted-foreground">{meta}</p>}
        </div>
        {!m.confirmed && (
          <span className="shrink-0 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">未确认考勤</span>
        )}
      </div>
      <div className="h-60 overflow-hidden rounded-md">
        <ClassroomMap mode="overview" rows={cls.seat_rows} cols={cls.seat_cols} deskSize={cls.desk_size}
          podium={podium} seats={cls.seats} views={views} />
      </div>
      <p className="text-sm text-muted-foreground">
        {`出勤 ${m.present}/${m.students} · 缺勤 ${m.absent} · 本周点评 ${signed(m.week_net)}`}
      </p>
    </article>
  )
}
