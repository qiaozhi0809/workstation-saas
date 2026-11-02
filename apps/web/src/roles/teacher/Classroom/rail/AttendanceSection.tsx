import { ATTENDANCE_LABEL } from '../attendance/cycle'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { ATTENDANCE_TONE, TONE_FILL } from '@/shared/lib/tone'
import type { AttendanceDay, AttendanceStatus } from '@/shared/types/attendance'
import type { StudentSeat } from '@/shared/types/student'

const MAX_LISTED = 4

export default function AttendanceSection({ day, roster, onRollCall }: {
  day: AttendanceDay | undefined
  roster: StudentSeat[]
  onRollCall(): void
}) {
  const total = roster.length
  const items = day?.items ?? []
  const count = (s: string) => items.filter((i) => i.status === s).length
  const leave = count('leave'), absent = count('absent'), late = count('late')
  const arrived = Math.max(0, total - leave - absent)
  // 进度条与异常名单按语义色调(出勤绿、请假黄、缺勤红、迟到蓝),与地图考勤标签同一套色调
  const segments: [AttendanceStatus | 'present', number][] = [
    ['present', Math.max(0, arrived - late)], ['late', late], ['leave', leave], ['absent', absent],
  ]
  const names = new Map(roster.map((s) => [s.enrollment_id, s.name]))
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">今日考勤</h3>
        {day?.confirmed_at && <span className="text-xs text-success">今日已确认</span>}
      </div>
      <p className="mt-1 text-sm">{`实到 ${arrived} / ${total}`}</p>
      <div aria-hidden className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
        {segments.map(([k, n]) => n > 0 && (
          <span key={k} data-status={k} className={TONE_FILL[ATTENDANCE_TONE[k]]} style={{ width: `${(n / Math.max(total, 1)) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{`请假 ${leave} · 缺勤 ${absent} · 迟到 ${late}`}</p>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {items.slice(0, MAX_LISTED).map((i) => (
            <li key={i.enrollment_id} className="flex items-center justify-between">
              <span>{names.get(i.enrollment_id) ?? ''}</span>
              <Badge variant={ATTENDANCE_TONE[i.status]}>{ATTENDANCE_LABEL[i.status].text}</Badge>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" className="mt-2 w-full" onClick={onRollCall}>去点名</Button>
    </Card>
  )
}
