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
const GENERIC_ERROR = '导入失败,请重试'
const GBK_UNSUPPORTED =
  '文件不是 UTF-8 编码,这个浏览器不能按 GBK 读取,请在 Excel 里另存为 UTF-8 的 CSV 后再试'

/** 一格在表里的位置:第几行(不含表头与空行,与"识别到 N 行"同一数法)与学生姓名 */
interface CellOrigin {
  row: number
  name: string
}

interface Plan {
  rows: number
  matched: number
  unmatched: number
  subjects: string[]
  cells: ScoreCell[]
  /** key = `${enrollment_id}|${subject}`,服务端拒绝某格时据此指出位置 */
  origin: Map<string, CellOrigin>
  rejected: number
  missingId: boolean
}

function plan(text: string, exam: Exam, roster: StudentSeat[], writable: string[] | null): Plan {
  const table = parseTable(text.replace(BOM, ''))
  const empty: Plan = {
    rows: 0,
    matched: 0,
    unmatched: 0,
    subjects: [],
    cells: [],
    origin: new Map(),
    rejected: 0,
    missingId: false,
  }
  if (table.length === 0) return empty
  const names = exam.subjects.filter((s) => writable === null || writable.includes(s.name))
  const cols = matchScoreColumns(
    table[0],
    names.map((s) => s.name),
  )
  if (cols.name === undefined && cols.no === undefined) return { ...empty, missingId: true }
  const subjects = names.filter((s) => cols.subjects[s.name] !== undefined)
  const out: Plan = { ...empty, rows: table.length - 1, subjects: subjects.map((s) => s.name) }
  const latest = new Map<string, ScoreCell>()
  table.slice(1).forEach((row, i) => {
    const seat = findStudent(
      roster,
      cols.name === undefined ? '' : (row[cols.name] ?? ''),
      cols.no === undefined ? '' : (row[cols.no] ?? ''),
    )
    if (!seat) {
      out.unmatched++
      return
    }
    out.matched++
    for (const s of subjects) {
      const p = parseScore(row[cols.subjects[s.name]] ?? '')
      if (p === 'clear') continue
      if (p !== 'absent' && (p === 'invalid' || p < 0 || p > s.full)) {
        out.rejected++
        continue
      }
      const key = `${seat.enrollment_id}|${s.name}`
      latest.set(key, { enrollment_id: seat.enrollment_id, subject: s.name, value: p })
      out.origin.set(key, { row: i + 1, name: seat.name })
    }
  })
  out.cells = [...latest.values()]
  return out
}

function summary(n: number, p: Plan): string {
  let msg = `已导入 ${n} 格`
  if (p.unmatched > 0) msg += `,${p.unmatched} 行没对上名字`
  if (p.rejected > 0) msg += `,${p.rejected} 格超出满分或格式不对,未导入`
  return msg
}

/** 服务端拒绝某一格(4xx 带 enrollment_id + subject)时指出它在表里的位置,好让老师回表里改 */
function describeError(e: unknown, p: Plan): string {
  if (!(e instanceof ApiError)) return GENERIC_ERROR
  const message = e.message || GENERIC_ERROR
  const d = e.details as { enrollment_id?: unknown; subject?: unknown } | undefined
  if (typeof d?.enrollment_id !== 'string' || typeof d.subject !== 'string') return message
  const at = p.origin.get(`${d.enrollment_id}|${d.subject}`)
  // 行号与"识别到 N 行"同一数法:不含表头,空行也不算
  return at ? `第 ${at.row} 行(不含表头与空行)· ${d.subject}(${at.name}):${message}` : message
}

/**
 * 先按 UTF-8 解码;出现替换字符说明不是 UTF-8(Excel 另存的 CSV 多半是 GBK),改按 GBK 再解一次。
 * 浏览器不支持 GBK 时保留 UTF-8 的结果并说明原因。
 */
function decodeCsv(bytes: ArrayBuffer): { text: string; problem: string | null } {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('\uFFFD')) return { text: utf8, problem: null }
  try {
    return { text: new TextDecoder('gbk').decode(bytes), problem: null }
  } catch {
    return { text: utf8, problem: GBK_UNSUPPORTED }
  }
}

export default function HeaderImport({
  classId,
  exam,
  roster,
  writable,
  onClose,
  onImported,
}: Props) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const p = useMemo(() => plan(text, exam, roster, writable), [text, exam, roster, writable])

  // 以点"导入"那一刻的方案为准:请求期间文本框还能改,报错定位不能跟着变
  const run = useMutation({
    mutationFn: async (snapshot: Plan) => {
      for (let i = 0; i < snapshot.cells.length; i += CHUNK) {
        await examsApi.saveScores(classId, exam.id, snapshot.cells.slice(i, i + CHUNK))
      }
    },
    // 中途某一批失败时前面的批次可能已写入,所以成功失败都刷新
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['score-sheet', classId, exam.id] }),
        qc.invalidateQueries({ queryKey: ['exams', classId] }),
        qc.invalidateQueries({ queryKey: ['gradebook', classId] }),
      ]),
    onSuccess: (_, snapshot) => {
      toast(summary(snapshot.cells.length, snapshot))
      onImported()
    },
    onError: (e, snapshot) => setError(describeError(e, snapshot)),
  })

  const readFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const decoded = decodeCsv(reader.result as ArrayBuffer)
      setText(decoded.text.replace(BOM, ''))
      setError(decoded.problem)
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissOnOutside={false}
      className="max-w-xl"
      title="按表头导入成绩"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          第一行是表头,需要有"姓名"或"学号"列,科目列名要和考试科目一致。空格子会跳过,不会清空已录的分数。
        </p>
        <Textarea
          aria-label="成绩表格"
          rows={8}
          value={text}
          placeholder="从 Excel 复制粘贴,或选择 CSV 文件"
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />
        <div>
          <label className="text-sm">
            <span className="mr-2">选择 CSV 文件</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="选择 CSV 文件"
              onChange={(e) => {
                readFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {p.missingId ? (
          <p className="text-sm text-destructive">第一行要有"姓名"或"学号"</p>
        ) : (
          text.trim() !== '' && (
            <p className="text-sm">
              <span>
                识别到 {p.rows} 行,匹配 {p.matched} 人;科目:{p.subjects.join('、') || '无'}
              </span>
              {p.unmatched > 0 && <span>,{p.unmatched} 行没对上名字</span>}
              {p.rejected > 0 && <span>,{p.rejected} 格超出满分或格式不对</span>}
              {p.cells.length === 0 && (
                <span className="ml-2 text-muted-foreground">没有可导入的分数</span>
              )}
            </p>
          )
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={run.isPending || p.cells.length === 0}
            onClick={() => {
              setError(null)
              run.mutate(p)
            }}
          >
            导入
          </Button>
        </div>
      </div>
    </Modal>
  )
}
