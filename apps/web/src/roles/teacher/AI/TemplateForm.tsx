import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AiField, AiPrompt, AiRequest, AiStatus, AiTemplate, AiValue } from '@/shared/types/ai'
import CopyPromptDialog from './CopyPromptDialog'
import MaskToggle from './MaskToggle'

const NO_COMPARE = ''

function defaultValue(f: AiField): AiValue {
  switch (f.type) {
    case 'select': return typeof f.default === 'string' ? f.default : (f.options?.[0] ?? '')
    case 'check': return f.default === true
    case 'students': return []
    case 'text': return typeof f.default === 'string' ? f.default : ''
    default: return ''
  }
}

/** 模板表单:按模板字段渲染,可复制提示词(总是可用)或开始生成(需已配置 AI)。 */
export default function TemplateForm({ template, classId, initial, status, onClose }: {
  template: AiTemplate
  classId: string
  initial?: Record<string, AiValue>
  status: AiStatus | undefined
  onClose(): void
}) {
  const navigate = useNavigate()
  const uid = useId()
  const hasExam = template.fields.some((f) => f.type === 'exam' || f.type === 'exam0')
  const hasRoster = template.fields.some((f) => f.type === 'student' || f.type === 'students')

  const [values, setValues] = useState<Record<string, AiValue>>(() => {
    const v: Record<string, AiValue> = {}
    template.fields.forEach((f) => {
      v[f.key] = initial && f.key in initial ? initial[f.key] : defaultValue(f)
    })
    return v
  })
  // 老师亲自选过的对比考试不再随「考试」联动
  const [chosen0, setChosen0] = useState<Set<string>>(
    () => new Set(template.fields.filter((f) => f.type === 'exam0' && initial && f.key in initial).map((f) => f.key)),
  )
  const [mask, setMask] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState<AiPrompt | null>(null)

  const students = useQuery({
    queryKey: ['class-students', classId],
    queryFn: () => studentsApi.listInClass(classId),
    enabled: hasRoster,
  })
  const exams = useQuery({
    queryKey: ['exams', classId],
    queryFn: () => examsApi.list(classId),
    enabled: hasExam,
  })
  const examList = exams.data?.items ?? []
  const roster = students.data?.items ?? []

  const examKey = template.fields.find((f) => f.type === 'exam')?.key ?? ''
  const examValue = (key: string): string => {
    const v = values[key]
    return typeof v === 'string' && v ? v : (examList[0]?.id ?? '')
  }
  const exam0Value = (f: AiField): string => {
    if (chosen0.has(f.key)) return (values[f.key] as string | null) ?? NO_COMPARE
    const cur = examList.findIndex((x) => x.id === examValue(examKey))
    return cur >= 0 ? (examList[cur + 1]?.id ?? NO_COMPARE) : NO_COMPARE
  }

  const set = (key: string, v: AiValue) => {
    setValues((s) => ({ ...s, [key]: v }))
    setErrors((e) => {
      if (!(key in e)) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
  }

  const masked = status?.mask_forced === true || mask
  const body = (): AiRequest => {
    const out: Record<string, AiValue> = {}
    template.fields.forEach((f) => {
      if (f.type === 'exam') out[f.key] = examValue(f.key)
      else if (f.type === 'exam0') out[f.key] = exam0Value(f) || null
      else out[f.key] = values[f.key]
    })
    return { class_id: classId, template_id: template.id, values: out, mask: masked }
  }

  const onError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'AI_FIELD_INVALID') {
        const field = (err.details as { field?: string } | undefined)?.field
        if (field) { setErrors((e) => ({ ...e, [field]: err.message })); return }
      }
      if (err.code === 'AI_NO_TARGETS') { toast('这两场考试之间没有退步 5 名及以上的同学'); return }
      toast(err.message)
      return
    }
    toast('请求失败,请重试')
  }

  const start = useMutation({
    mutationFn: () => aiApi.createChat(body()),
    onSuccess: (chat) => navigate(`/teacher/ai/${chat.id}?go=1`),
    onError,
  })
  const copy = useMutation({
    mutationFn: () => aiApi.prompt(body()),
    onSuccess: setPrompt,
    onError,
  })
  const busy = start.isPending || copy.isPending
  const configured = status?.configured === true

  const wrap = (f: AiField, control: ReactNode, id: string, group = false) => (
    <div key={f.key} className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">
        {group ? <span>{f.label}</span> : <label htmlFor={id}>{f.label}</label>}
        {f.required && <span aria-hidden="true" className="text-destructive"> *</span>}
      </div>
      {control}
      {errors[f.key] && <p role="alert" className="text-xs text-destructive">{errors[f.key]}</p>}
    </div>
  )

  const renderField = (f: AiField) => {
    const id = `${uid}-${f.key}`
    const bad = errors[f.key] ? true : undefined
    switch (f.type) {
      case 'text':
        return wrap(f, (
          <Input id={id} aria-invalid={bad} value={values[f.key] as string} placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)} />
        ), id)
      case 'textarea':
        return wrap(f, (
          <Textarea id={id} aria-invalid={bad} rows={3} value={values[f.key] as string} placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)} />
        ), id)
      case 'select':
        return wrap(f, (
          <div role="group" aria-label={f.label} className="flex flex-wrap gap-2">
            {(f.options ?? []).map((o) => (
              <Button key={o} type="button" size="sm" aria-pressed={values[f.key] === o}
                variant={values[f.key] === o ? 'default' : 'outline'} onClick={() => set(f.key, o)}>
                {o}
              </Button>
            ))}
          </div>
        ), id, true)
      case 'check':
        return (
          <div key={f.key} className="text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
              {f.label}
            </label>
          </div>
        )
      case 'student':
        return wrap(f, (
          <NativeSelect id={id} aria-invalid={bad} className="w-full" value={values[f.key] as string}
            onChange={(e) => set(f.key, e.target.value)}>
            <option value="">请选择</option>
            {roster.map((s) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
          </NativeSelect>
        ), id)
      case 'students': {
        const picked = values[f.key] as string[]
        const toggle = (sid: string, on: boolean) =>
          set(f.key, on ? [...picked, sid] : picked.filter((x) => x !== sid))
        return wrap(f, (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Button type="button" size="sm" variant="outline" onClick={() => set(f.key, roster.map((s) => s.student_id))}>全选</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => set(f.key, [])}>全不选</Button>
              <span className="text-muted-foreground">已选 {picked.length} 人</span>
            </div>
            <div role="group" aria-label={f.label}
              className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 text-sm sm:grid-cols-3">
              {roster.map((s) => (
                <label key={s.student_id} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={picked.includes(s.student_id)}
                    onChange={(e) => toggle(s.student_id, e.target.checked)} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        ), id, true)
      }
      case 'exam':
        return wrap(f, (
          <NativeSelect id={id} aria-invalid={bad} className="w-full" value={examValue(f.key)}
            onChange={(e) => set(f.key, e.target.value)}>
            {examList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        ), id)
      case 'exam0':
        return wrap(f, (
          <NativeSelect id={id} aria-invalid={bad} className="w-full" value={exam0Value(f)}
            onChange={(e) => {
              setChosen0((s) => new Set(s).add(f.key))
              set(f.key, e.target.value || null)
            }}>
            <option value={NO_COMPARE}>不对比</option>
            {examList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        ), id)
    }
  }

  return (
    <Modal open onClose={onClose} title={template.title} description={template.desc} className="max-w-xl">
      <div className="space-y-4">
        {template.fields.map(renderField)}
        <div className="space-y-1 border-t border-border pt-3">
          <MaskToggle status={status} checked={mask} onChange={setMask} />
          {masked && (
            <p className="text-xs text-muted-foreground">学生姓名会先换成编号再发送,结果回来后自动换回</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => copy.mutate()}>复制提示词</Button>
          <Button
            type="button"
            disabled={!configured || busy}
            title={configured ? undefined : '未配置 AI 服务,可以先复制提示词到其他 AI 工具使用'}
            onClick={() => start.mutate()}
          >
            开始生成
          </Button>
        </div>
      </div>
      {prompt && <CopyPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </Modal>
  )
}
