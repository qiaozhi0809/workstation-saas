import { addDays, ageOn, daysUntilBirthday } from '@/shared/lib/date'
import { Card } from '@/shared/components/ui/card'
import type { StudentSeat } from '@/shared/types/student'

const MAX_LISTED = 5
const WINDOW_DAYS = 6
const when = (n: number) => (n === 0 ? '今天' : n === 1 ? '明天' : `${n} 天后`)

export default function BirthdaySection({ roster, today }: { roster: StudentSeat[]; today: string }) {
  const upcoming = roster
    .flatMap((s) => {
      if (!s.birthdate) return []
      const days = daysUntilBirthday(s.birthdate, today)
      return days <= WINDOW_DAYS ? [{ s, days, age: ageOn(s.birthdate, addDays(today, days)) }] : []
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, MAX_LISTED)
  return (
    <Card className="p-3">
      <h3 className="text-sm font-semibold">生日提醒</h3>
      {upcoming.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">近 7 天没有同学过生日</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {upcoming.map(({ s, days, age }) => (
            <li key={s.enrollment_id} className="flex items-center justify-between gap-2">
              <span>{s.name}</span>
              <span className="text-xs text-muted-foreground">
                <span>{when(days)}</span>{' · '}<span>{`${age} 岁`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
