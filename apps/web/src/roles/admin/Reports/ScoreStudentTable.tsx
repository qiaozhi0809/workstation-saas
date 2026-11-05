import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { ScoreStudentRow } from '@/shared/types/admin'

type Key = 'name' | 'total' | 'class_rank' | 'grade_rank' | `s:${string}`
interface Sort {
  key: Key
  dir: 'asc' | 'desc'
}

const DASH = '—'
const show = (v: number | null) => (v === null ? DASH : String(v))

function valueOf(r: ScoreStudentRow, key: Key): number | string | null {
  if (key === 'name') return r.name
  if (key === 'total') return r.total
  if (key === 'class_rank') return r.class_rank
  if (key === 'grade_rank') return r.grade_rank
  return r.scores[key.slice(2)] ?? null
}

/** 空值永远排最后;其余按 dir 比较 */
function sortRows(rows: ScoreStudentRow[], sort: Sort | null): ScoreStudentRow[] {
  if (!sort) return rows
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = valueOf(a, sort.key)
    const y = valueOf(b, sort.key)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    if (typeof x === 'string' || typeof y === 'string')
      return sign * String(x).localeCompare(String(y), 'zh')
    return sign * (x - y)
  })
}

// 首次点分数列从高到低,点名次列从小到大
const firstDir = (key: Key): Sort['dir'] =>
  key === 'name' || key === 'class_rank' || key === 'grade_rank' ? 'asc' : 'desc'

const th = 'px-3 py-2 font-medium'

export default function ScoreStudentTable({
  label,
  subjects,
  rows,
}: {
  label: string
  subjects: string[]
  rows: ScoreStudentRow[]
}) {
  const [sort, setSort] = useState<Sort | null>(null)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])

  const toggle = (key: Key) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) },
    )

  const head = (key: Key, text: string, align: 'left' | 'right') => {
    const active = sort?.key === key ? sort.dir : null
    return (
      <th
        scope="col"
        key={key}
        aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
        className={cn(th, align === 'left' ? 'text-left' : 'text-right')}
      >
        <button
          type="button"
          onClick={() => toggle(key)}
          className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text}
          {active === 'asc' && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
          {active === 'desc' && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
        </button>
      </th>
    )
  }

  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table aria-label={label} className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-muted-foreground">
            <th scope="col" className={cn(th, 'text-left')}>
              学号
            </th>
            {head('name', '姓名', 'left')}
            {subjects.map((s) => head(`s:${s}`, s, 'right'))}
            {head('total', '总分', 'right')}
            {head('class_rank', '班级名次', 'right')}
            {head('grade_rank', '年级名次', 'right')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.student_id} className="border-b last:border-0">
              <td className="px-3 py-2 text-left text-muted-foreground">{r.student_no ?? DASH}</td>
              <td className="px-3 py-2 text-left">{r.name}</td>
              {subjects.map((s) => (
                <td key={s} className="px-3 py-2 text-right tabular-nums">
                  {show(r.scores[s] ?? null)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">{show(r.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{show(r.class_rank)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{show(r.grade_rank)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
