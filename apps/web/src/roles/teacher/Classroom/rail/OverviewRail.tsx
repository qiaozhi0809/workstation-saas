import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { cn } from '@/shared/lib/utils'
import type { AttendanceDay } from '@/shared/types/attendance'
import type { ClassPerm, ClassroomSummary } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'
import AttendanceSection from './AttendanceSection'
import BirthdaySection from './BirthdaySection'
import FeedSection from './FeedSection'
import TodaySection from './TodaySection'
import TodoSection from './TodoSection'

export default function OverviewRail({ classId, summary, roster, perms, todayAttendance, variant, onClose, onRollCall }: {
  classId: string
  summary: ClassroomSummary
  roster: StudentSeat[]
  perms: readonly ClassPerm[]
  /** 学校"今天"的考勤,与考勤模式 / 点名共用同一份缓存 */
  todayAttendance: AttendanceDay | undefined
  /** inline:舞台右侧固定一栏;overlay:窄屏下盖在舞台上,带标题行和收起按钮 */
  variant: 'inline' | 'overlay'
  onClose(): void
  onRollCall(): void
}) {
  const overlay = variant === 'overlay'
  useEscapeLayer(overlay, onClose)
  const closeRef = useRef<HTMLButtonElement>(null)
  // 窄屏浮层打开时把焦点移进来;只在挂载时,跨断点切换形态不抢焦点
  useEffect(() => { if (overlay) closeRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside aria-label="班级概况" className={cn(
      'flex flex-col gap-3 overflow-y-auto',
      overlay
        ? 'absolute inset-y-3 right-3 z-30 w-[min(320px,calc(100%-1.5rem))] rounded-xl border bg-background p-3 shadow-lg'
        : 'w-[300px] shrink-0',
    )}>
      {overlay && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">班级概况</h2>
          <Button ref={closeRef} type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="收起概况栏" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      )}
      <TodaySection summary={summary} roster={roster} />
      {perms.includes('attendance.read') && (
        <AttendanceSection day={todayAttendance} roster={roster} onRollCall={onRollCall} />
      )}
      <BirthdaySection roster={roster} today={summary.today} />
      <TodoSection />
      {perms.includes('review.read') && (
        <FeedSection classId={classId} roster={roster} timezone={summary.timezone} />
      )}
    </aside>
  )
}
