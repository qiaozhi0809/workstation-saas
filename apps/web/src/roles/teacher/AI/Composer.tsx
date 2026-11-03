import type { KeyboardEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AiPrompt, AiRequest, AiStatus } from '@/shared/types/ai'
import CopyPromptDialog from './CopyPromptDialog'
import MaskToggle from './MaskToggle'

/** 自由对话输入框:文字 + 资料开关;已配置直接开对话,未配置生成可复制的提示词。 */
export default function Composer({ classId, status, canReadExams }: {
  classId: string
  status: AiStatus | undefined
  canReadExams: boolean
}) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [withClass, setWithClass] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [examId, setExamId] = useState('')
  const [mask, setMask] = useState(true)
  const [prompt, setPrompt] = useState<AiPrompt | null>(null)

  const students = useQuery({
    queryKey: ['class-students', classId],
    queryFn: () => studentsApi.listInClass(classId),
  })
  const exams = useQuery({
    queryKey: ['exams', classId],
    queryFn: () => examsApi.list(classId),
    enabled: canReadExams,
  })

  const configured = status?.configured === true
  const masked = status?.mask_forced === true || mask
  const body = (): AiRequest => ({
    class_id: classId,
    template_id: null,
    values: {},
    text: text.trim(),
    context: { class: withClass, student_id: studentId || null, exam_id: examId || null },
    mask: masked,
  })
  const send = useMutation({
    mutationFn: async (): Promise<{ chatId: string } | { prompt: AiPrompt }> =>
      configured ? { chatId: (await aiApi.createChat(body())).id } : { prompt: await aiApi.prompt(body()) },
    onSuccess: (res) => {
      if ('chatId' in res) navigate(`/teacher/ai/${res.chatId}?go=1`)
      else setPrompt(res.prompt)
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : configured ? '发送失败,请重试' : '生成提示词失败,请重试'),
  })

  const canSend = status !== undefined && text.trim().length > 0 && !send.isPending
  const submit = () => { if (canSend) send.mutate() }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <Textarea
        aria-label="要做什么"
        placeholder="直接说要做什么,比如:帮我写一份期中考试后的家长会发言稿"
        value={text}
        maxLength={4000}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={withClass} onChange={(e) => setWithClass(e.target.checked)} />
          班级概况
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">+ 学生档案</span>
          <NativeSelect aria-label="+ 学生档案" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">不选</option>
            {(students.data?.items ?? []).map((s) => (
              <option key={s.student_id} value={s.student_id}>{s.name}</option>
            ))}
          </NativeSelect>
        </label>
        {canReadExams && (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">+ 考试数据</span>
            <NativeSelect aria-label="+ 考试数据" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">不选</option>
              {(exams.data?.items ?? []).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        <MaskToggle status={status} checked={mask} onChange={setMask} />
        <Button className="ml-auto" disabled={!canSend} onClick={submit}>
          {configured ? '发送' : '复制提示词'}
        </Button>
      </div>
      {prompt && <CopyPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}
