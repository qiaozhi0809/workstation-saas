import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { ATTENDANCE_TONE, TONE_TEXT } from '@/shared/lib/tone'

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
      <Input
        type="date"
        aria-label="考勤日期"
        className="h-8 w-auto"
        value={p.date}
        min={p.yearStart}
        max={p.today}
        onChange={(e) => { if (e.target.value) p.onPickDate(e.target.value) }}
      />
      {p.date !== p.today && (
        <Button type="button" variant="outline" size="sm" onClick={p.onFollowToday}>回到今天</Button>
      )}
      <span className="font-semibold tabular-nums">{`实到 ${p.enrolled - p.leave - p.absent}/${p.enrolled}`}</span>
      <span className={TONE_TEXT[ATTENDANCE_TONE.leave]}>{`请假 ${p.leave}`}</span>
      <span className={TONE_TEXT[ATTENDANCE_TONE.absent]}>{`缺勤 ${p.absent}`}</span>
      <span className={TONE_TEXT[ATTENDANCE_TONE.late]}>{`迟到 ${p.late}`}</span>
      {p.confirmedAt && <span className="text-muted-foreground">{`已确认 ${p.confirmedAt}`}</span>}
      <div className="ml-auto flex items-center gap-2">
        {p.canWrite && (
          <>
            <Button type="button" variant="outline" size="sm" disabled={p.busy} onClick={p.onConfirm}>确认考勤</Button>
            <Button type="button" variant="outline" size="sm" disabled={p.busy} onClick={p.onAllPresent}>全部出勤</Button>
          </>
        )}
        <Button type="button" variant="outline" size="sm" onClick={p.onExport}>导出本月</Button>
      </div>
    </div>
  )
}
