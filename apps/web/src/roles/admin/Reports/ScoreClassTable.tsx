import {
  Table,
  TableBody,
  TableFoot,
  TableHead,
  TableRow,
  Td,
  Th,
} from '@/shared/components/ui/table'
import type { ScoreSummary, SubjectStat, TotalStat } from '@/shared/types/admin'
import StatTip from './StatTip'

export type ScoreView = 'avg' | 'pass' | 'good'

const DASH = '—'
const fmtAvg = (v: number | null) => (v === null ? DASH : v.toFixed(1))
const fmtRate = (v: number | null) => (v === null ? DASH : `${(v * 100).toFixed(1)}%`)
const fmtNum = (v: number | null) => (v === null ? DASH : String(v))

function tip(s: { max: number | null; min: number | null; count: number }) {
  return `最高 ${fmtNum(s.max)} · 最低 ${fmtNum(s.min)} · 参考 ${s.count} 人`
}

function subjectText(s: SubjectStat, view: ScoreView) {
  return view === 'avg'
    ? fmtAvg(s.avg)
    : view === 'pass'
      ? fmtRate(s.pass_rate)
      : fmtRate(s.good_rate)
}

// 总分没有及格率 / 优秀率,只在平均分视图里显示
const totalText = (t: TotalStat, view: ScoreView) => (view === 'avg' ? fmtAvg(t.avg) : DASH)

// 按科目名取统计,不依赖数组顺序与表头一致
const byName = (stats: SubjectStat[], name: string) => stats.find((s) => s.subject === name)

/** 有数值的格子带可聚焦的最高 / 最低 / 参考人数提示;破折号的格子没有 */
function ValueCell({
  text,
  stat,
}: {
  text: string
  stat: { max: number | null; min: number | null; count: number }
}) {
  return <Td numeric>{text === DASH ? DASH : <StatTip text={text} tip={tip(stat)} />}</Td>
}

function StatCell({ stat, view }: { stat: SubjectStat | undefined; view: ScoreView }) {
  if (!stat) return <Td numeric>{DASH}</Td>
  return <ValueCell text={subjectText(stat, view)} stat={stat} />
}

export default function ScoreClassTable({
  summary,
  view,
  openClassId,
  onToggle,
}: {
  summary: ScoreSummary
  view: ScoreView
  openClassId: string | null
  onToggle(classId: string): void
}) {
  return (
    <Table aria-label="班级成绩汇总">
      <TableHead>
        <TableRow className="bg-muted/50">
          <Th>班级</Th>
          {summary.subjects.map((s) => (
            <Th key={s.name} numeric>
              {s.name}
            </Th>
          ))}
          <Th numeric>总分</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        {summary.classes.map((c) => {
          const open = c.class_id === openClassId
          return (
            <TableRow key={c.class_id}>
              <Th scope="row" className="text-sm font-medium text-foreground">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  aria-expanded={open}
                  onClick={() => onToggle(c.class_id)}
                  className="-ml-3"
                >
                  {c.class_name}
                </Button>
              </Th>
              {summary.subjects.map((h) => (
                <StatCell key={h.name} stat={byName(c.subjects, h.name)} view={view} />
              ))}
              <ValueCell text={totalText(c.total, view)} stat={c.total} />
            </TableRow>
          )
        })}
      </TableBody>
      <TableFoot>
        <TableRow className="bg-muted/30">
          <Th scope="row" className="text-sm font-medium text-foreground">
            全年级
          </Th>
          {summary.subjects.map((h) => (
            <StatCell key={h.name} stat={byName(summary.grade.subjects, h.name)} view={view} />
          ))}
          <ValueCell text={totalText(summary.grade.total, view)} stat={summary.grade.total} />
        </TableRow>
      </TableFoot>
    </Table>
  )
}
