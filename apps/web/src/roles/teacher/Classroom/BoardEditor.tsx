import { useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import type { Board } from '@/shared/types/classroom'

const MAX_TITLE = 10
const MAX_TEXT = 120
const MAX_LINES = 4
const MAX_LABEL = 12

const len = (s: string) => Array.from(s).length

interface Form {
  left_title: string
  left_text: string
  right_title: string
  right_text: string
  countdown_label: string
  countdown_date: string
}

/** 与契约一致的前端校验,返回第一条错误(没有则 null)。 */
function validate(f: Form): string | null {
  for (const t of [f.left_title, f.right_title]) {
    const n = len(t.trim())
    if (n < 1 || n > MAX_TITLE) return `黑板标题要填 1–${MAX_TITLE} 个字`
  }
  for (const t of [f.left_text, f.right_text]) {
    if (t.split('\n').length > MAX_LINES) return `每块黑板最多 ${MAX_LINES} 行`
    if (len(t) > MAX_TEXT) return `每块黑板最多 ${MAX_TEXT} 个字`
  }
  const label = f.countdown_label.trim()
  if (!label !== !f.countdown_date) return '倒计时名称和日期要一起填'
  if (len(label) > MAX_LABEL) return `倒计时名称最多 ${MAX_LABEL} 个字`
  return null
}

export default function BoardEditor({
  classId,
  board,
  onClose,
}: {
  classId: string
  board: Board
  onClose(): void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>(() => ({
    left_title: board.left_title,
    left_text: board.left_text,
    right_title: board.right_title,
    right_text: board.right_text,
    countdown_label: board.countdown_label ?? '',
    countdown_date: board.countdown_date ?? '',
  }))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const id = useId()

  const set = (key: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    if (inFlight.current) return
    const problem = validate(form)
    setError(problem)
    if (problem) return
    inFlight.current = true
    setSaving(true)
    const label = form.countdown_label.trim()
    const payload: Board = {
      left_title: form.left_title.trim(),
      left_text: form.left_text,
      right_title: form.right_title.trim(),
      right_text: form.right_text,
      countdown_label: label || null,
      countdown_date: form.countdown_date || null,
    }
    try {
      await classroomApi.saveBoard(classId, payload)
      await queryClient.invalidateQueries({ queryKey: ['classroom', classId] })
      onClose()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '保存失败,请重试')
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑黑板"
      dismissOnOutside={false}
      className="sm:max-w-[560px]"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['left', '左'],
              ['right', '右'],
            ] as const
          ).map(([side, name]) => (
            <div key={side} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${side}-title`}>{`${name}黑板标题`}</Label>
                <Input
                  id={`${id}-${side}-title`}
                  value={form[`${side}_title`]}
                  onChange={set(`${side}_title`)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${side}-text`}>{`${name}黑板内容`}</Label>
                <Textarea
                  id={`${id}-${side}-text`}
                  rows={4}
                  value={form[`${side}_text`]}
                  onChange={set(`${side}_text`)}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-countdown-label`}>倒计时名称</Label>
            <Input
              id={`${id}-countdown-label`}
              value={form.countdown_label}
              onChange={set('countdown_label')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-countdown-date`}>倒计时日期</Label>
            <Input
              id={`${id}-countdown-date`}
              type="date"
              value={form.countdown_date}
              onChange={set('countdown_date')}
            />
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
          <Button type="submit" disabled={saving}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
