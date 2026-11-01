import { toolButton } from '../Toolbar'

export interface AttendanceBarProps {
  date: string
  today: string
  yearStart: string
  enrolled: number
  leave: number
  absent: number
  late: number
  /** 已确认的时刻(已按学校时区格式化成 HH:mm);未确认为 null */
  confirmedAt: string | null
  canWrite: boolean
  busy: boolean
  onPickDate(d: string): void
  onFollowToday(): void
  onConfirm(): void
  onAllPresent(): void
  onExport(): void
}

export default function AttendanceBar(p: AttendanceBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        type="date"
        aria-label="考勤日期"
        className="rounded-lg border border-line-2 bg-panel px-2 py-1"
        value={p.date}
        min={p.yearStart}
        max={p.today}
        onChange={(e) => { if (e.target.value) p.onPickDate(e.target.value) }}
      />
      {p.date !== p.today && (
        <button type="button" className={toolButton} onClick={p.onFollowToday}>回到今天</button>
      )}
      <span className="font-semibold">{`实到 ${p.enrolled - p.leave - p.absent}/${p.enrolled}`}</span>
      <span className="text-amber">{`请假 ${p.leave}`}</span>
      <span className="text-red">{`缺勤 ${p.absent}`}</span>
      <span className="text-blue">{`迟到 ${p.late}`}</span>
      {p.confirmedAt && <span className="text-ink-2">{`已确认 ${p.confirmedAt}`}</span>}
      <div className="ml-auto flex items-center gap-2">
        {p.canWrite && (
          <>
            <button type="button" className={toolButton} disabled={p.busy} onClick={p.onConfirm}>确认考勤</button>
            <button type="button" className={toolButton} disabled={p.busy} onClick={p.onAllPresent}>全部出勤</button>
          </>
        )}
        <button type="button" className={toolButton} onClick={p.onExport}>导出本月</button>
      </div>
    </div>
  )
}
