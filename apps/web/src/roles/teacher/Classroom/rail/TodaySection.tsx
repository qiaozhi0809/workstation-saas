import { genderOf } from '@/shared/components/ClassroomMap/art/StudentFigure'
import { formatMonthDay, weekdayCN } from '@/shared/lib/date'
import { Card } from '@/shared/components/ui/card'
import type { ClassroomSummary } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'

export default function TodaySection({ summary, roster }: { summary: ClassroomSummary; roster: StudentSeat[] }) {
  const male = roster.filter((s) => genderOf(s.gender) === 'male').length
  const female = roster.filter((s) => genderOf(s.gender) === 'female').length
  const cells: [string, number][] = [['在籍', roster.length], ['男生', male], ['女生', female]]
  return (
    <Card className="p-3">
      <p className="text-sm font-semibold">{`${formatMonthDay(summary.today)} ${weekdayCN(summary.today)}`}</p>
      <p className="text-xs text-muted-foreground">{`${summary.year.name} 学年 · 第 ${summary.week_no} 周`}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        {cells.map(([label, n]) => (
          <span key={label} className="rounded-md bg-muted py-1">{`${label} ${n}`}</span>
        ))}
      </div>
    </Card>
  )
}
