import { cn } from '@/shared/lib/utils'
import type { ScoreSummary, SubjectStat, TotalStat } from '@/shared/types/admin'

export type ScoreView = 'avg' | 'pass' | 'good'

const DASH = '—'
const fmtAvg = (v: number | null) => (v === null ? DASH : v.toFixed(1))
const fmtRate = (v: number | null) => (v === null ? DASH : `${(v * 100).toFixed(1)}%`)
const fmtNum = (v: number | null) => (v === null ? DASH : String(v))

function tip(s: { max: number | null; min: number | null; count: number }) {
  return `最高 ${fmtNum(s.max)} · 最低 ${fmtNum(s.min)} · 参考 ${s.count} 人`
}

function subjectText(s: SubjectStat, view: ScoreView) {
  return view === 'avg' ? fmtAvg(s.avg) : view === 'pass' ? fmtRate(s.pass_rate) : fmtRate(s.good_rate)
}

// 总分没有及格率 / 优秀率,只在平均分视图里显示
const totalText = (t: TotalStat, view: ScoreView) => (view === 'avg' ? fmtAvg(t.avg) : DASH)

const cell = 'px-3 py-2 text-right tabular-nums'

export default function ScoreClassTable({ summary, view, openClassId, onToggle }: {
  summary: ScoreSummary
  view: ScoreView
  openClassId: string | null
  onToggle(classId: string): void
}) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table aria-label="班级成绩汇总" className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left font-medium">班级</th>
            {summary.subjects.map((s) => (
              <th key={s.name} scope="col" className={cn(cell, 'font-medium')}>{s.name}</th>
            ))}
            <th scope="col" className={cn(cell, 'font-medium')}>总分</th>
          </tr>
        </thead>
        <tbody>
          {summary.classes.map((c) => {
            const open = c.class_id === openClassId
            return (
              <tr key={c.class_id} className="border-b">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <button type="button" aria-expanded={open} onClick={() => onToggle(c.class_id)}
                    className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.class_name}
                  </button>
                </th>
                {c.subjects.map((s) => (
                  <td key={s.subject} title={tip(s)} className={cell}>{subjectText(s, view)}</td>
                ))}
                <td title={tip(c.total)} className={cell}>{totalText(c.total, view)}</td>
              </tr>
            )
          })}
          <tr className="bg-muted/30 font-medium">
            <th scope="row" className="px-3 py-2 text-left">全年级</th>
            {summary.grade.subjects.map((s) => (
              <td key={s.subject} title={tip(s)} className={cell}>{subjectText(s, view)}</td>
            ))}
            <td title={tip(summary.grade.total)} className={cell}>{totalText(summary.grade.total, view)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
