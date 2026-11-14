import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ClassroomMap from '@/shared/components/ClassroomMap'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import type { BoardClass } from '@/shared/types/admin'
import { attendanceViews, signed } from './attendanceViews'

export default function ClassCard({ cls }: { cls: BoardClass }) {
  const views = useMemo(() => attendanceViews(cls.attendance), [cls.attendance])
  const podium = useMemo(
    () => ({ left: cls.podium_left, right: cls.podium_right }),
    [cls.podium_left, cls.podium_right],
  )
  const m = cls.metrics
  const to = `/admin/classes/${encodeURIComponent(cls.id)}`
  return (
    <Card
      data-class-card
      className="relative flex min-w-0 flex-col gap-2 p-4 focus-within:ring-2 focus-within:ring-ring hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium">
            <Link
              to={to}
              className="rounded-sm after:absolute after:inset-0 after:z-10 focus-visible:outline-none"
            >
              {cls.name}
            </Link>
          </h2>
          {cls.room && (
            <p className="truncate text-sm text-muted-foreground">{`教室 ${cls.room}`}</p>
          )}
          {cls.homeroom_name && (
            <p data-homeroom className="text-sm text-muted-foreground">
              {`班主任 ${cls.homeroom_name}`}
            </p>
          )}
        </div>
        {!m.confirmed && (
          <Badge variant="warning" className="shrink-0">
            未确认考勤
          </Badge>
        )}
      </div>
      <div className="pointer-events-none h-60 overflow-hidden rounded-md">
        <ClassroomMap
          mode="overview"
          rows={cls.seat_rows}
          cols={cls.seat_cols}
          deskSize={cls.desk_size}
          podium={podium}
          seats={cls.seats}
          views={views}
        />
      </div>
      <p className="text-sm tabular-nums text-muted-foreground">
        {`出勤 ${m.present}/${m.students} · 缺勤 ${m.absent} · 本周点评 ${signed(m.week_net)}`}
      </p>
    </Card>
  )
}
