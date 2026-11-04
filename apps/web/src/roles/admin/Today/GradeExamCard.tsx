import { Link } from 'react-router-dom'
import type { TodayView } from '@/shared/types/admin'

/** 可见范围内最近一场联考的录分进度;没有联考时不渲染 */
export function GradeExamCard({ exam }: { exam: TodayView['grade_exam'] }) {
  if (!exam) return null
  const pct = exam.expected > 0 ? Math.min(100, Math.round((exam.entered / exam.expected) * 100)) : 0
  return (
    <section aria-label="年级联考" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">年级联考</h2>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{exam.name}</span>
        <span className="text-sm text-muted-foreground">{exam.grade_name}</span>
      </div>
      <div className="flex flex-col gap-1">
        <div role="progressbar" aria-label="录分进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm text-muted-foreground">{`已录 ${exam.entered} / ${exam.expected}`}</span>
      </div>
      <Link to={`/admin/reports/scores?exam=${encodeURIComponent(exam.id)}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">查看成绩汇总</Link>
    </section>
  )
}
