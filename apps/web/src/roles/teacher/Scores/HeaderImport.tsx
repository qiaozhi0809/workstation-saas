import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { findStudent, matchScoreColumns } from '@/shared/lib/columns'
import { parseScore } from '@/shared/lib/grades'
import { parseTable } from '@/shared/lib/table'
import type { Exam, ScoreCell } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'

interface Props {
  classId: string
  exam: Exam
  roster: StudentSeat[]
  /** null = 全部科目 */
  writable: string[] | null
  onClose(): void
  onImported(): void
}

const CHUNK = 2000
const BOM = new RegExp('^\uFEFF')

interface Plan {
  rows: number
  matched: number
  unmatched: number
  subjects: string[]
  cells: ScoreCell[]
  rejected: number
  missingId: boolean
}

function plan(text: string, exam: Exam, roster: StudentSeat[], writable: string[] | null): Plan {
  const table = parseTable(text.replace(BOM, ''))
  const empty: Plan = { rows: 0, matched: 0, unmatched: 0, subjects: [], cells: [], rejected: 0, missingId: false }
  if (table.length === 0) return empty
  const names = exam.subjects.filter((s) => writable === null || writable.includes(s.name))
  const cols = matchScoreColumns(table[0], names.map((s) => s.name))
  if (cols.name === undefined && cols.no === undefined) return { ...empty, missingId: true }
  const subjects = names.filter((s) => cols.subjects[s.name] !== undefined)
  const out: Plan = { ...empty, rows: table.length - 1, subjects: subjects.map((s) => s.name) }
  for (const row of table.slice(1)) {
    const seat = findStudent(roster, cols.name === undefined ? '' : (row[cols.name] ?? ''), cols.no === undefined ? '' : (row[cols.no] ?? ''))
    if (!seat) { out.unmatched++; continue }
    out.matched++
    for (const s of subjects) {
      const p = parseScore(row[cols.subjects[s.name]] ?? '')
      if (p === 'clear') continue
      if (p === 'absent') out.cells.push({ enrollment_id: seat.enrollment_id, subject: s.name, value: 'absent' })
      else if (p === 'invalid' || p < 0 || p > s.full) out.rejected++
      else out.cells.push({ enrollment_id: seat.enrollment_id, subject: s.name, value: p })
    }
  }
  return out
}

function summary(n: number, p: Plan): string {
  let msg = `已导入 ${n} 格`
  if (p.unmatched > 0) msg += `,${p.unmatched} 行没对上名字`
  if (p.rejected > 0) msg += `,${p.rejected} 格超出满分或格式不对,未导入`
  return msg
}

export default function HeaderImport({ classId, exam, roster, writable, onClose, onImported }: Props) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const p = useMemo(() => plan(text, exam, roster, writable), [text, exam, roster, writable])

  const run = useMutation({
    mutationFn: async () => {
      for (let i = 0; i < p.cells.length; i += CHUNK) {
        await examsApi.saveScores(classId, exam.id, p.cells.slice(i, i + CHUNK))
      }
    },
    onSuccess: async () => {
      toast(summary(p.cells.length, p))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['score-sheet', classId, exam.id] }),
        qc.invalidateQueries({ queryKey: ['exams', classId] }),
        qc.invalidateQueries({ queryKey: ['gradebook', classId] }),
      ])
      onImported()
    },
    onError: (e) => setError(e instanceof ApiError && e.message ? e.message : '导入失败,请重试'),
  })

  const readFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result ?? '').replace(BOM, '')); setError(null) }
    reader.readAsText(file, 'utf-8')
  }

  return (
    <Modal open onClose={onClose} dismissOnOutside={false} className="max-w-xl" title="按表头导入成绩">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          第一行是表头,需要有"姓名"或"学号"列,科目列名要和考试科目一致。空格子会跳过,不会清空已录的分数。
        </p>
        <Textarea aria-label="成绩表格" rows={8} value={text} placeholder="从 Excel 复制粘贴,或选择 CSV 文件"
          onChange={(e) => { setText(e.target.value); setError(null) }} />
        <div>
          <label className="text-sm">
            <span className="mr-2">选择 CSV 文件</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" aria-label="选择 CSV 文件"
              onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        </div>
        {p.missingId
          ? <p className="text-sm text-destructive">第一行要有"姓名"或"学号"</p>
          : text.trim() !== '' && (
            <p className="text-sm">
              识别到 {p.rows} 行,匹配 {p.matched} 人;科目:{p.subjects.join('、') || '无'}
            </p>
          )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={run.isPending || p.cells.length === 0} onClick={() => { setError(null); run.mutate() }}>
            导入
          </Button>
        </div>
      </div>
    </Modal>
  )
}
