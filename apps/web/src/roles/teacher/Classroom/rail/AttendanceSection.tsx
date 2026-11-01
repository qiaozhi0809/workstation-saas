import { ATTENDANCE_LABEL } from '../attendance/cycle'
import type { AttendanceDay } from '@/shared/types/attendance'
import type { StudentSeat } from '@/shared/types/student'

// 与地图上的考勤标签同色(ATTENDANCE_LABEL):请假琥珀、缺勤红、迟到蓝
const BAR: Record<string, string> = { present: 'bg-green', leave: 'bg-amber', absent: 'bg-red', late: 'bg-blue' }
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
  const segments: [string, number][] = [
    ['present', Math.max(0, arrived - late)], ['late', late], ['leave', leave], ['absent', absent],
  ]
  const names = new Map(roster.map((s) => [s.enrollment_id, s.name]))
  return (
    <section className="rounded-2xl border border-line bg-panel p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">今日考勤</h3>
        {day?.confirmed_at && <span className="text-xs text-green">今日已确认</span>}
      </div>
      <p className="mt-1 text-sm">{`实到 ${arrived} / ${total}`}</p>
      <div aria-hidden className="mt-1 flex h-2 overflow-hidden rounded-full bg-fill">
        {segments.map(([k, n]) => n > 0 && (
          <span key={k} data-status={k} className={BAR[k]} style={{ width: `${(n / Math.max(total, 1)) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-2">{`请假 ${leave} · 缺勤 ${absent} · 迟到 ${late}`}</p>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {items.slice(0, MAX_LISTED).map((i) => (
            <li key={i.enrollment_id} className="flex items-center justify-between">
              <span>{names.get(i.enrollment_id) ?? ''}</span>
              <span className="rounded-full bg-fill px-2 text-xs">{ATTENDANCE_LABEL[i.status].text}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onRollCall}
        className="mt-2 w-full rounded-lg bg-ink py-1 text-sm text-white">去点名</button>
    </section>
  )
}
