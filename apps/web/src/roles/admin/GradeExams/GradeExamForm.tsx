import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { schoolApi } from '@/shared/api/school'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { GradeExam, GradeExamInput } from '@/shared/types/admin'
import { EXAM_TYPES, type ExamType, type SubjectFull } from '@/shared/types/grades'
import { STAGE_LABEL, type Stage } from '@/shared/types/school'
import { errMsg } from '../Org/errMsg'
import Field from '../Org/Field'
import { invalidateTeacherExamCaches } from './teacherCache'

const NAME_MAX = 30

/** 可选科目:目录里的按目录满分;考试里已有的按考试满分;考试里有但目录没有的保留并标注 */
interface Option extends SubjectFull {
  legacy: boolean
}

function buildOptions(catalog: SubjectFull[], exam: GradeExam | undefined): Option[] {
  const inExam = new Map((exam?.subjects ?? []).map((s) => [s.name, s.full]))
  const options: Option[] = catalog.map((s) => ({
    name: s.name,
    full: inExam.get(s.name) ?? s.full,
    legacy: false,
  }))
  for (const [name, full] of inExam)
    if (!options.some((o) => o.name === name)) options.push({ name, full, legacy: true })
  return options
}

export default function GradeExamForm({
  gradeId,
  stage,
  exam,
  today,
  onClose,
  onSaved,
}: {
  gradeId: string
  /** 年级的学段键,来自 GET /school/grades 的 effective_stage(L234);契约允许为 null,此时读不到目录 */
  stage: Stage | null
  exam?: GradeExam
  today: string
  onClose(): void
  onSaved(): void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(exam?.name ?? '')
  const [date, setDate] = useState(exam?.date ?? today)
  const [type, setType] = useState<ExamType>(exam?.exam_type ?? '月考')
  // null = 还没按目录初始化(新建默认全选,编辑默认选考试里已有的)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const catalog = useQuery({
    queryKey: ['school', 'subject-catalog'],
    queryFn: schoolApi.subjectCatalog,
  })
  const options = catalog.data && stage ? buildOptions(catalog.data[stage], exam) : null
  const selected = picked ?? new Set((exam ? exam.subjects : (options ?? [])).map((s) => s.name))

  const save = useMutation({
    mutationFn: (input: GradeExamInput) =>
      exam ? adminApi.updateGradeExam(exam.id, input) : adminApi.createGradeExam(input),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['grade-exams'] })
      void qc.invalidateQueries({ queryKey: ['report', 'scores'] })
      // 编辑前后的班都算受影响(保存时可能顺带补建了班)
      invalidateTeacherExamCaches(qc, [...(exam?.classes ?? []), ...saved.classes])
      onSaved()
    },
    onError: (e) => setError(errMsg(e)),
  })

  const toggle = (subject: string) => {
    const next = new Set(selected)
    if (next.has(subject)) next.delete(subject)
    else next.add(subject)
    setPicked(next)
  }

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
    // 编辑时保持考试原有的科目顺序,新勾上的按目录序追加在后;新建时就是目录序
    const all = options ?? []
    const ordered = exam
      ? [
          ...exam.subjects.flatMap((s) => all.filter((o) => o.name === s.name)),
          ...all.filter((o) => !exam.subjects.some((s) => s.name === o.name)),
        ]
      : all
    const subjects = ordered
      .filter((o) => selected.has(o.name))
      .map((o) => ({ name: o.name, full: o.full }))
    if (subjects.length === 0) {
      setError('至少选择一个科目')
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
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">科目与满分</span>
            {stage && (
              <span className="text-xs text-muted-foreground">{`${STAGE_LABEL[stage]}目录`}</span>
            )}
          </div>
          {!stage ? (
            <p role="alert" className="text-destructive">
              这个年级还没有学段,读不到科目目录;请先到组织架构里给年级设学段
            </p>
          ) : options ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {options.map((o) => (
                <li key={o.name}>
                  <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={o.name}
                      checked={selected.has(o.name)}
                      onChange={() => toggle(o.name)}
                    />
                    <span className="flex-1">{o.name}</span>
                    {o.legacy && <span className="text-xs text-warning">已不在目录</span>}
                    <span className="text-xs text-muted-foreground">{`满分 ${o.full}`}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : catalog.isError ? (
            <p role="alert" className="text-destructive">
              科目目录加载失败,请关闭后重试
            </p>
          ) : (
            <LoadingState />
          )}
          <p className="text-xs text-muted-foreground">
            可选科目来自学校设置里的科目目录;要加新科目请先去学校设置里维护目录。
          </p>
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
          <Button type="submit" disabled={save.isPending || !options}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
