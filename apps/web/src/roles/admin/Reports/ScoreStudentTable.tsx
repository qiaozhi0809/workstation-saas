import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
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

  const head = (key: Key, text: string, numeric: boolean) => {
    const active = sort?.key === key ? sort.dir : null
    return (
      <Th
        key={key}
        numeric={numeric}
        aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
      >
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => toggle(key)}
          className={cn(
            'gap-1 px-2 font-medium text-muted-foreground hover:bg-accent hover:no-underline',
            numeric ? '-mr-2' : '-ml-2',
          )}
        >
          {text}
          {active === 'asc' && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
          {active === 'desc' && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
        </Button>
      </Th>
    )
  }

  return (
    <Table aria-label={label} containerClassName="w-fit max-w-full">
      <TableHead>
        <TableRow className="bg-muted/50">
          <Th>学号</Th>
          {head('name', '姓名', false)}
          {subjects.map((s) => head(`s:${s}`, s, true))}
          {head('total', '总分', true)}
          {head('class_rank', '班级名次', true)}
          {head('grade_rank', '年级名次', true)}
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.student_id}>
            <Td className="text-muted-foreground">{r.student_no ?? DASH}</Td>
            <Td>{r.name}</Td>
            {subjects.map((s) => (
              <Td key={s} numeric>
                {show(r.scores[s] ?? null)}
              </Td>
            ))}
            <Td numeric>{show(r.total)}</Td>
            <Td numeric>{show(r.class_rank)}</Td>
            <Td numeric>{show(r.grade_rank)}</Td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
