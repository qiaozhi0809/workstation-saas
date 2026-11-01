import type { BoardData } from '@/shared/components/ClassroomMap/types'
import { daysBetween, formatMonthDay, weekdayCN } from '@/shared/lib/date'
import type { ClassroomSummary } from '@/shared/types/classroom'
import type { ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'

const SHOW = 3

const lines = (text: string) => text.split('\n').filter((l) => l.trim() !== '')

// 学号按数字感知比较,没有学号的排后面;再按姓名
function byStudentNoThenName(a: StudentSeat, b: StudentSeat): number {
  if (a.student_no !== b.student_no) {
    if (a.student_no == null) return 1
    if (b.student_no == null) return -1
    const c = a.student_no.localeCompare(b.student_no, undefined, { numeric: true })
    if (c !== 0) return c
  }
  return a.name.localeCompare(b.name, 'zh-Hans-CN')
}

export function buildBoard({ className, today, summary, roster, reviewSummary }: {
  className: string
  today: string
  summary: ClassroomSummary
  roster: StudentSeat[]
  reviewSummary?: ReviewSummary
}): BoardData {
  const b = summary.board

  const days = b.countdown_label && b.countdown_date ? daysBetween(today, b.countdown_date) : -1
  const countdown = b.countdown_label && days >= 0 ? { label: b.countdown_label, days } : null

  const byId = new Map(roster.map((s) => [s.enrollment_id, s]))
  const stars = (reviewSummary?.items ?? [])
    .flatMap((t) => {
      const s = byId.get(t.enrollment_id)
      return s && t.week > 0 ? [{ s, week: t.week }] : []
    })
    .sort((x, y) => y.week - x.week || byStudentNoThenName(x.s, y.s))
    .slice(0, SHOW)
    .map(({ s, week }) => ({ name: s.name, points: week }))

  const month = today.slice(5, 7)
  const birthdays = roster
    .filter((s) => s.birthdate?.slice(5, 7) === month)
    .sort((x, y) => x.birthdate!.slice(8).localeCompare(y.birthdate!.slice(8)) || byStudentNoThenName(x, y))
    .slice(0, SHOW)
    .map((s) => ({ name: s.name, date: s.birthdate!.slice(5) }))

  return {
    leftTitle: b.left_title,
    leftLines: lines(b.left_text),
    rightTitle: b.right_title,
    rightLines: lines(b.right_text),
    screenTitle: `${className} · ${formatMonthDay(today)} ${weekdayCN(today)}`,
    countdown,
    stars,
    birthdays,
  }
}
