import { SeatCard } from '@/shared/components/ClassroomMap/HoverCard'
import type { AttendanceStatus } from '@/shared/types/attendance'
import type { StudentSeat } from '@/shared/types/student'
import { ATTENDANCE_LABEL } from './attendance/cycle'
import { signed } from './review/signed'

/**
 * 教室页的座位悬停卡:姓名、学号、职务(地图默认卡片)+ 今日考勤(学校"今天",无记录即出勤)+ 本周积分。
 * attendance 为 undefined 表示今天的考勤还没取到;week 为 undefined 表示没有 review.read,不显示积分。
 */
export default function SeatHoverCard({
  seat,
  attendance,
  week,
  groupOf,
}: {
  seat: StudentSeat
  /** 座位所属小组序号(0 起),与地图着色一致 */
  groupOf(seat: StudentSeat): number
  attendance: AttendanceStatus | 'present' | undefined
  week: number | undefined
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SeatCard seat={seat} group={groupOf(seat)} />
      {(attendance || week !== undefined) && (
        <div className="flex flex-col border-t border-border pt-1.5 text-sm leading-5 text-muted-foreground">
          {attendance && (
            <span>{`今日考勤 ${attendance === 'present' ? '出勤' : ATTENDANCE_LABEL[attendance].text}`}</span>
          )}
          {week !== undefined && <span>{`本周积分 ${signed(week)}`}</span>}
        </div>
      )}
    </div>
  )
}
