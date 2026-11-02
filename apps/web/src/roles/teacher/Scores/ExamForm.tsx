import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { EXAM_TYPES, type Exam, type ExamInput, type ExamType, type SubjectFull } from '@/shared/types/grades'

interface Props {
  classId: string
  exam?: Exam
  today: string
  mySubjects: string[]
  canAllSubjects: boolean
  onClose(): void
  onSaved(exam: Exam): void
  onDeleted?(): void
}

interface Chip { name: string; full: string; selected: boolean }

const DELETE_FORBIDDEN = '这场考试里还有其他老师负责的科目，不能删除'
const NAME_MAX = 30

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'FULL_BELOW_SCORES') {
    const subject = (e.details as { subject?: string } | undefined)?.subject ?? ''
    return `${subject} 的满分低于已录入的最高分`
  }
  if (e instanceof ApiError && e.message) return e.message
  return '保存失败,请重试'
}

const FULL_MSG = '满分须为 1–1000 的整数'
const validFull = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000

export default function ExamForm(props: Props) {
  const subjects = useQuery({
    queryKey: ['class-subjects', props.classId],
    queryFn: () => examsApi.subjects(props.classId),
  })
  return (
    <Modal open onClose={props.onClose} dismissOnOutside={false} className="max-w-lg"
      title={props.exam ? '编辑考试' : '新建考试'}>
      {subjects.data
        ? <FormBody {...props} catalog={subjects.data.items} />
        : subjects.isError
          ? <p role="alert" className="text-sm text-destructive">科目加载失败,请关闭后重试</p>
          : <LoadingState />}
    </Modal>
  )
}

function initialChips(p: Props, catalog: SubjectFull[]): Chip[] {
  const allowed = (name: string) => p.canAllSubjects || p.mySubjects.includes(name)
  const base: SubjectFull[] = catalog.filter((s) => allowed(s.name))
  if (!p.canAllSubjects) {
    for (const name of p.mySubjects) if (!base.some((s) => s.name === name)) base.push({ name, full: 100 })
  }
  const inExam = new Map((p.exam?.subjects ?? []).map((s) => [s.name, s.full]))
  const chips: Chip[] = base.map((s) => {
    const full = inExam.get(s.name)
    return { name: s.name, full: String(full ?? s.full), selected: p.exam ? full !== undefined : true }
  })
  // 编辑时,考试里已有但不在科目表里的科目也要保留
  for (const [name, full] of inExam) {
    if (!chips.some((c) => c.name === name)) chips.push({ name, full: String(full), selected: true })
  }
  return chips
}

function FormBody(p: Props & { catalog: SubjectFull[] }) {
  const qc = useQueryClient()
  const [name, setName] = useState(p.exam?.name ?? '')
  const [date, setDate] = useState(p.exam?.date ?? p.today)
  const [type, setType] = useState<ExamType>(p.exam?.exam_type ?? '月考')
  const [chips, setChips] = useState<Chip[]>(() => initialChips(p, p.catalog))
  const [newName, setNewName] = useState('')
  const [newFull, setNewFull] = useState('100')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [dropAck, setDropAck] = useState(false)

  const invalidate = () => Promise.all(
    ['exams', 'gradebook', 'score-sheet', 'class-subjects'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  )

  const save = useMutation({
    mutationFn: (input: ExamInput) => p.exam
      ? examsApi.update(p.classId, p.exam.id, input)
      : examsApi.create(p.classId, input),
    onSuccess: (saved) => { p.onSaved(saved); void invalidate() },
    onError: (e) => setError(errorText(e)),
  })
  const remove = useMutation({
    mutationFn: () => examsApi.remove(p.classId, p.exam!.id),
    onSuccess: () => { p.onDeleted?.(); void invalidate() },
    onError: (e) => {
      setConfirming(false)
      setError(e instanceof ApiError && (e.status === 403 || e.code === 'FORBIDDEN') ? DELETE_FORBIDDEN : '删除失败,请重试')
    },
  })

  const patch = (n: string, change: Partial<Chip>) =>
    setChips((cs) => cs.map((c) => (c.name === n ? { ...c, ...change } : c)))

  const addCustom = () => {
    const n = newName.trim()
    const full = Number(newFull)
    if (!n) return
    if (!validFull(full)) { setError(FULL_MSG); return }
    if (!p.canAllSubjects && !p.mySubjects.includes(n)) { setError('只能添加你任教的科目'); return }
    setError(null)
    if (chips.some((c) => c.name === n)) patch(n, { selected: true, full: String(full) })
    else setChips((cs) => [...cs, { name: n, full: String(full), selected: true }])
    setNewName('')
    setNewFull('100')
  }

  // 编辑时,原考试里有、现在被取消勾选的科目:保存会连同已录分数一起删除
  const dropped = p.exam ? p.exam.subjects.map((s) => s.name).filter((n) => !chips.some((c) => c.name === n && c.selected)) : []

  const submit = () => {
    const n = name.trim()
    const picked = chips.filter((c) => c.selected)
    if (!n) { setError('请填写考试名称'); return }
    if (n.length > NAME_MAX) { setError(`考试名称不能超过 ${NAME_MAX} 个字`); return }
    if (!date) { setError('请选择日期'); return }
    if (picked.length === 0) { setError('至少选择一个科目'); return }
    if (picked.some((c) => !validFull(Number(c.full)))) { setError(FULL_MSG); return }
    setError(null)
    if (dropped.length > 0 && !dropAck) { setDropAck(true); return }
    save.mutate({
      name: n, exam_type: type, date,
      subjects: picked.map((c) => ({ name: c.name, full: Number(c.full) })),
    })
  }

  const busy = save.isPending || remove.isPending

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">考试名称</span>
        <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">日期</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <div role="group" aria-label="考试类型" className="flex flex-col gap-1 text-sm">
        <span className="font-medium">类型</span>
        <div className="flex flex-wrap gap-2">
          {EXAM_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={t === type} onClick={() => setType(t)}
              className={chipClass(t === type)}>{t}</button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="科目" className="flex flex-col gap-2 text-sm">
        <span className="font-medium">科目与满分</span>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c.name} className="flex items-center gap-1">
              <button type="button" aria-pressed={c.selected}
                onClick={() => { setDropAck(false); patch(c.name, { selected: !c.selected }) }}
                className={chipClass(c.selected)}>{c.name}</button>
              <Input type="number" min={1} max={1000} step={1} aria-label={`${c.name} 满分`} className="h-8 w-20"
                value={c.full} disabled={!c.selected}
                onChange={(e) => patch(c.name, { full: e.target.value })} />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input aria-label="新科目名称" maxLength={10} placeholder="添加科目" className="h-8 w-32" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addCustom() }
            }} />
          <Input type="number" min={1} max={1000} step={1} aria-label="新科目满分" className="h-8 w-20" value={newFull}
            onChange={(e) => setNewFull(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addCustom() }
            }} />
          <Button type="button" variant="outline" size="sm" onClick={addCustom}>添加</Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {dropAck && dropped.length > 0 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          去掉「{dropped.join('、')}」会同时删除该科已录的分数
        </p>
      )}

      {confirming && p.exam && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="text-destructive">删除「{p.exam.name}」及其全部分数?</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" size="sm" disabled={busy}
              onClick={() => remove.mutate()}>确认删除</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>取消</Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {p.exam && !confirming
          ? <Button type="button" variant="ghost" className="text-destructive" disabled={busy}
              onClick={() => setConfirming(true)}>删除考试</Button>
          : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={p.onClose}>取消</Button>
          <Button type="submit" disabled={busy}>保存</Button>
        </div>
      </div>
    </form>
  )
}

function chipClass(on: boolean) {
  return cn(
    'rounded-full border px-3 py-1 text-sm transition-colors',
    on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-foreground hover:bg-accent',
  )
}
