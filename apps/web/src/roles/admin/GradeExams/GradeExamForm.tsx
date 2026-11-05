import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { adminApi } from '@/shared/api/admin'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { GradeExam, GradeExamInput } from '@/shared/types/admin'
import { EXAM_TYPES, type ExamType } from '@/shared/types/grades'
import { errMsg } from '../Org/errMsg'
import Field from '../Org/Field'

const NAME_MAX = 30
const FULL_MSG = '满分须为 1–1000 的整数'
const validFull = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000

interface Row {
  name: string
  full: string
}

const DEFAULT_ROWS: Row[] = [
  { name: '语文', full: '100' },
  { name: '数学', full: '100' },
  { name: '英语', full: '100' },
]

export default function GradeExamForm({
  gradeId,
  exam,
  today,
  onClose,
  onSaved,
}: {
  gradeId: string
  exam?: GradeExam
  today: string
  onClose(): void
  onSaved(): void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(exam?.name ?? '')
  const [date, setDate] = useState(exam?.date ?? today)
  const [type, setType] = useState<ExamType>(exam?.exam_type ?? '月考')
  const [rows, setRows] = useState<Row[]>(() =>
    exam ? exam.subjects.map((s) => ({ name: s.name, full: String(s.full) })) : DEFAULT_ROWS,
  )
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: GradeExamInput) =>
      exam ? adminApi.updateGradeExam(exam.id, input) : adminApi.createGradeExam(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grade-exams'] })
      void qc.invalidateQueries({ queryKey: ['report', 'scores'] })
      onSaved()
    },
    onError: (e) => setError(errMsg(e)),
  })

  const patch = (i: number, change: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)))

  const submit = () => {
    const n = name.trim()
    if (!n) {
      setError('请填写考试名称')
      return
    }
    if (n.length > NAME_MAX) {
      setError(`考试名称不能超过 ${NAME_MAX} 个字`)
      return
    }
    if (!date) {
      setError('请选择日期')
      return
    }
    if (rows.length === 0) {
      setError('至少添加一个科目')
      return
    }
    const subjects = rows.map((r) => ({ name: r.name.trim(), full: Number(r.full) }))
    if (subjects.some((s) => !s.name)) {
      setError('科目名称不能为空')
      return
    }
    if (new Set(subjects.map((s) => s.name)).size !== subjects.length) {
      setError('科目名称不能重复')
      return
    }
    if (subjects.some((s) => !validFull(s.full))) {
      setError(FULL_MSG)
      return
    }
    setError(null)
    save.mutate({ grade_id: exam?.grade_id ?? gradeId, name: n, exam_type: type, date, subjects })
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissOnOutside={false}
      className="max-w-lg"
      title={exam ? '编辑联考' : '新建联考'}
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="考试名称">
          <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="日期">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div role="group" aria-label="考试类型" className="grid gap-1 text-sm">
          <span className="text-muted-foreground">类型</span>
          <div className="flex flex-wrap gap-2">
            {EXAM_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === type}
                onClick={() => setType(t)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  t === type
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-label="科目" className="grid gap-2 text-sm">
          <span className="text-muted-foreground">科目与满分</span>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`科目 ${i + 1} 名称`}
                maxLength={10}
                className="h-8 w-32"
                value={r.name}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              <Input
                type="number"
                min={1}
                max={1000}
                step={1}
                aria-label={`科目 ${i + 1} 满分`}
                className="h-8 w-24"
                value={r.full}
                onChange={(e) => patch(i, { full: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`删除科目 ${i + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { name: '', full: '100' }])}
            >
              添加科目
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={save.isPending}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
