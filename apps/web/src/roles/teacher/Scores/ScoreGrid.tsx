import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { toast } from '@/shared/components/Toast'
import { useGrading } from '@/shared/hooks/useGrading'
import { cellState, examTable, parseScore, type CellState } from '@/shared/lib/grades'
import { parseTable } from '@/shared/lib/table'
import { cn } from '@/shared/lib/utils'
import type { Exam, ScoreCell, ScoreSheet, ScoreValue } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { compareRoster } from '@/shared/lib/rosterOrder'

const without = <T,>(rec: Record<string, T>, key: string) => {
  const { [key]: dropped, ...rest } = rec
  void dropped
  return rest
}

const keyOf = (enrollmentId: string, subject: string) => `${enrollmentId}|${subject}`

/** 格子里的值:number 分数,null 缺考,undefined 没有记录 */
const valueOf = (c: ScoreCell): ScoreValue | undefined =>
  c.value === 'absent' ? null : c.value === null ? undefined : c.value

const show = (v: ScoreValue | undefined) => (v === undefined ? '' : v === null ? '缺考' : String(v))

const STATE_CLASS: Record<CellState, string> = {
  empty: '',
  ok: '',
  absent: 'bg-warning/10',
  low: 'text-destructive',
  over: 'bg-destructive/10 text-destructive',
}

/** 输入文字 → 能保存的格子值;不能保存时给出原因 */
function interpret(text: string, full: number): { cell: ScoreCell['value'] } | { problem: string } {
  const p = parseScore(text)
  if (p === 'invalid') return { problem: '格式不对,未保存' }
  if (p === 'clear') return { cell: null }
  if (p === 'absent') return { cell: 'absent' }
  if (p < 0 || p > full) return { problem: `超出满分 ${full},未保存` }
  return { cell: p }
}

export interface ScoreGridProps {
  exam: Exam
  roster: StudentSeat[]
  sheet: ScoreSheet
  /** 可写科目名;null = 全部可写 */
  writable: string[] | null
  onCells(cells: ScoreCell[]): void
  /** 这些格子(key = `${enrollment_id}|${subject}`)的文字被拒绝,撤回尚未发出的改动 */
  onDiscard(keys: string[]): void
}

export default function ScoreGrid({
  exam,
  roster,
  sheet,
  writable,
  onCells,
  onDiscard,
}: ScoreGridProps) {
  const grading = useGrading()
  const students = useMemo(() => [...roster].sort(compareRoster), [roster])
  const subjects = exam.subjects
  // 未保存的改动(保存成功并合并进 sheet 后会被清掉);草稿文字只在输入过程中保留,无法保存的文字一直留着
  const [overlay, setOverlay] = useState<Record<string, ScoreCell>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const refs = useRef(new Map<string, HTMLInputElement>())

  const server = useMemo(() => {
    const m: Record<string, Record<string, ScoreValue>> = {}
    for (const it of sheet.items) m[it.enrollment_id] = it.scores
    return m
  }, [sheet])

  useEffect(() => {
    setOverlay((cur) => {
      const keep = Object.entries(cur).filter(
        ([, c]) => server[c.enrollment_id]?.[c.subject] !== valueOf(c),
      )
      return keep.length === Object.keys(cur).length ? cur : Object.fromEntries(keep)
    })
  }, [server])

  const valueAt = (id: string, subject: string): ScoreValue | undefined => {
    const o = overlay[keyOf(id, subject)]
    return o ? valueOf(o) : server[id]?.[subject]
  }

  const table = useMemo(() => {
    const scores: Record<string, Record<string, ScoreValue>> = {}
    for (const s of students) {
      const rec: Record<string, ScoreValue> = {}
      for (const { name } of subjects) {
        const o = overlay[keyOf(s.enrollment_id, name)]
        const v = o ? valueOf(o) : server[s.enrollment_id]?.[name]
        if (v !== undefined) rec[name] = v
      }
      scores[s.enrollment_id] = rec
    }
    const rows = examTable(
      { ...exam, scores },
      students.map((s) => s.enrollment_id),
    )
    return new Map(rows.map((r) => [r.id, r]))
  }, [students, subjects, exam, overlay, server])

  const canWrite = (subject: string) => writable === null || writable.includes(subject)

  /** 把一段文字写进一格;返回是否被接受(false = 无法保存,文字留在格里标红) */
  const apply = (id: string, subject: string, full: number, text: string): boolean => {
    const key = keyOf(id, subject)
    const r = interpret(text, full)
    if ('problem' in r) {
      setDrafts((d) => ({ ...d, [key]: text }))
      setOverlay((o) => without(o, key))
      onDiscard([key])
      return false
    }
    const cell: ScoreCell = { enrollment_id: id, subject, value: r.cell }
    setOverlay((o) => ({ ...o, [key]: cell }))
    return true
  }

  const change = (id: string, subject: string, full: number, text: string) => {
    const key = keyOf(id, subject)
    setDrafts((d) => ({ ...d, [key]: text }))
    const r = interpret(text, full)
    if (apply(id, subject, full, text) && 'cell' in r)
      onCells([{ enrollment_id: id, subject, value: r.cell }])
  }

  const focusCell = (r: number, c: number) => refs.current.get(`${r}:${c}`)?.focus()

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const go = (nr: number, nc: number) => {
      e.preventDefault()
      focusCell(nr, nc)
    }
    switch (e.key) {
      case 'Enter':
        return go(e.shiftKey ? r - 1 : r + 1, c)
      case 'ArrowDown':
        return go(r + 1, c)
      case 'ArrowUp':
        return go(r - 1, c)
      case 'ArrowRight':
        if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length)
          go(r, c + 1)
        return
      case 'ArrowLeft':
        if (el.selectionStart === 0 && el.selectionEnd === 0) go(r, c - 1)
        return
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r0: number, c0: number) => {
    const text = e.clipboardData.getData('text')
    if (!/[\t\n\r]/.test(text)) return
    e.preventDefault()
    const cells: ScoreCell[] = []
    let rejected = 0
    let skipped = 0
    parseTable(text, true).forEach((line, dr) => {
      const student = students[r0 + dr]
      if (!student) {
        skipped += line.filter((raw) => raw !== '').length
        return
      }
      line.forEach((raw, dc) => {
        const sub = subjects[c0 + dc]
        if (raw === '') return
        if (!sub || !canWrite(sub.name)) {
          skipped++
          return
        }
        const r = interpret(raw, sub.full)
        if (apply(student.enrollment_id, sub.name, sub.full, raw)) {
          // 粘贴成功的格子不再保留草稿文字
          setDrafts((d) => without(d, keyOf(student.enrollment_id, sub.name)))
          if ('cell' in r)
            cells.push({ enrollment_id: student.enrollment_id, subject: sub.name, value: r.cell })
        } else rejected++
      })
    })
    onCells(cells)
    toast(
      `已粘贴 ${cells.length} 格${skipped ? `,${skipped} 格在表格外或不可编辑,已跳过` : ''}${rejected ? `;${rejected} 格超出满分或格式不对,未保存` : ''}`,
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
              学号
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
              姓名
            </th>
            {subjects.map((s) => (
              <th key={s.name} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {s.name} /{s.full}
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
              总分
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
              排名
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, r) => {
            const row = table.get(s.enrollment_id)
            return (
              <tr key={s.enrollment_id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-1 text-muted-foreground">
                  {s.student_no ?? ''}
                </td>
                <td className="whitespace-nowrap px-3 py-1">{s.name}</td>
                {subjects.map((sub, c) => {
                  const key = keyOf(s.enrollment_id, sub.name)
                  const draft = drafts[key]
                  const bad = draft === undefined ? null : interpret(draft, sub.full)
                  const problem = bad && 'problem' in bad ? bad.problem : null
                  const v = valueAt(s.enrollment_id, sub.name)
                  const readOnly = !canWrite(sub.name)
                  return (
                    <td key={sub.name} className="px-1 py-1">
                      <input
                        ref={(el) => {
                          if (el) refs.current.set(`${r}:${c}`, el)
                          else refs.current.delete(`${r}:${c}`)
                        }}
                        inputMode="decimal"
                        aria-label={`${s.name} ${sub.name}`}
                        readOnly={readOnly}
                        title={problem ?? undefined}
                        value={draft ?? show(v)}
                        className={cn(
                          'w-20 rounded border border-transparent bg-transparent px-2 py-1 text-right focus:border-ring focus:outline-none',
                          readOnly && 'cursor-not-allowed text-muted-foreground',
                          problem ? STATE_CLASS.over : STATE_CLASS[cellState(v, sub.full, grading)],
                        )}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => {
                          if (!problem) setDrafts((d) => without(d, key))
                        }}
                        onChange={(e) => {
                          if (!readOnly) change(s.enrollment_id, sub.name, sub.full, e.target.value)
                        }}
                        onKeyDown={(e) => onKeyDown(e, r, c)}
                        onPaste={(e) => onPaste(e, r, c)}
                      />
                    </td>
                  )
                })}
                <td data-testid="total" className="whitespace-nowrap px-3 py-1 tabular-nums">
                  {row?.total ?? '—'}
                </td>
                <td data-testid="rank" className="whitespace-nowrap px-3 py-1 tabular-nums">
                  {row?.rank ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
