import { Link } from 'react-router-dom'
import { GRADE_TINTS } from '@/shared/components/ClassroomMap/art/palette'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'

export interface GradesBarExam { id: string; name: string }

const LEGEND = [
  { tint: 1, label: '前 20%' }, { tint: 2, label: '20–40%' }, { tint: 3, label: '40–60%' },
  { tint: 4, label: '60–80%' }, { tint: 5, label: '后 20%' },
] as const

/** exams:新→旧;没有考试时显示空提示和录入入口。 */
export default function GradesBar({ exams, value, onChange, analysisHref }: {
  exams: GradesBarExam[]
  value: string
  onChange(id: string): void
  analysisHref: string
}) {
  if (exams.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">还没有考试成绩</span>
        <Button asChild variant="outline"><Link to="/teacher/scores">去录入</Link></Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <NativeSelect aria-label="选择考试" value={value} onChange={(e) => onChange(e.target.value)}>
        {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </NativeSelect>
      <ul aria-label="名次图例" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <li key={l.tint} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-4 rounded-sm border" style={{ background: GRADE_TINTS[l.tint] }} />
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-4 rounded-sm border bg-muted opacity-40" />
          无成绩
        </li>
      </ul>
      <Button asChild variant="outline"><Link to={analysisHref}>完整分析</Link></Button>
    </div>
  )
}
