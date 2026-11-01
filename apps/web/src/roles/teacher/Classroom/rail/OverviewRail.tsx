import type { AttendanceDay } from '@/shared/types/attendance'
import type { ClassPerm, ClassroomSummary } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'
import AttendanceSection from './AttendanceSection'
import BirthdaySection from './BirthdaySection'
import FeedSection from './FeedSection'
import TodaySection from './TodaySection'
import TodoSection from './TodoSection'

export default function OverviewRail({ classId, summary, roster, perms, todayAttendance, onRollCall }: {
  classId: string
  summary: ClassroomSummary
  roster: StudentSeat[]
  perms: readonly ClassPerm[]
  /** 学校"今天"的考勤,与考勤模式 / 点名共用同一份缓存 */
  todayAttendance: AttendanceDay | undefined
  onRollCall(): void
}) {
  return (
    <aside aria-label="班级概况" className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto">
      {(
        <>
          <TodaySection summary={summary} roster={roster} />
          {perms.includes('attendance.read') && (
            <AttendanceSection day={todayAttendance} roster={roster} onRollCall={onRollCall} />
          )}
          <BirthdaySection roster={roster} today={summary.today} />
        </>
      )}
      <TodoSection />
      {perms.includes('review.read') && (
        <FeedSection classId={classId} roster={roster} timezone={summary.timezone} />
      )}
    </aside>
  )
}
