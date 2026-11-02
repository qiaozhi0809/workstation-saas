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
  /** 出勤小牌在场景里看得到时,可见的数字退到牌子上;看不到时显示紧凑徽章 */
  boardVisible?: boolean
  canWrite: boolean
  busy: boolean
  onPickDate(d: string): void
  onFollowToday(): void
  onConfirm(): void
  onAllPresent(): void
  onExport(): void
}

export default function AttendanceBar(p: AttendanceBarProps) {
  const arrived = p.enrolled - p.leave - p.absent
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        type="date"
        aria-label="考勤日期"
        className="h-9 w-auto"
        value={p.date}
        min={p.yearStart}
        max={p.today}
        onChange={(e) => { if (e.target.value) p.onPickDate(e.target.value) }}
      />
      {p.date !== p.today && (
        <Button type="button" variant="outline" onClick={p.onFollowToday}>回到今天</Button>
      )}
      {/* 数字的读屏文字始终在;可见的部分:牌子看得到时由场景承担,看不到时是紧凑徽章 */}
      <span className="sr-only">{`实到 ${arrived}/${p.enrolled}`}</span>
      <span className={`sr-only ${TONE_TEXT[ATTENDANCE_TONE.leave]}`}>{`请假 ${p.leave}`}</span>
      <span className={`sr-only ${TONE_TEXT[ATTENDANCE_TONE.absent]}`}>{`缺勤 ${p.absent}`}</span>
      <span className={`sr-only ${TONE_TEXT[ATTENDANCE_TONE.late]}`}>{`迟到 ${p.late}`}</span>
      {!p.boardVisible && (
        <span aria-hidden="true" title={`实到 ${arrived}/${p.enrolled} · 请假 ${p.leave} · 缺勤 ${p.absent} · 迟到 ${p.late}`}
          className="rounded-full border bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
          {`${arrived}/${p.enrolled}`}
        </span>
      )}
      {p.confirmedAt && <span className="text-muted-foreground">{`已确认 ${p.confirmedAt}`}</span>}
      {p.canWrite && (
        <>
          <Button type="button" variant="outline" disabled={p.busy} onClick={p.onConfirm}>确认考勤</Button>
          <Button type="button" variant="outline" disabled={p.busy} onClick={p.onAllPresent}>全部出勤</Button>
        </>
      )}
      <Button type="button" variant="outline" onClick={p.onExport}>导出本月</Button>
    </div>
  )
}
