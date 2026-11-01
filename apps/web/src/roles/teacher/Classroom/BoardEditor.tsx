import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { toast } from '@/shared/components/Toast'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { Board } from '@/shared/types/classroom'
import { toolButton } from './Toolbar'

const MAX_TITLE = 10
const MAX_TEXT = 120
const MAX_LINES = 4
const MAX_LABEL = 12
const primaryButton =
  'rounded-lg bg-ink px-3 py-1 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const inputClass = 'rounded-lg border border-line-2 bg-panel px-2 py-1 text-sm'

const len = (s: string) => Array.from(s).length

interface Form {
  left_title: string; left_text: string; right_title: string; right_text: string
  countdown_label: string; countdown_date: string
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

export default function BoardEditor({ classId, board, onClose }: { classId: string; board: Board; onClose(): void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>(() => ({
    left_title: board.left_title, left_text: board.left_text,
    right_title: board.right_title, right_text: board.right_text,
    countdown_label: board.countdown_label ?? '', countdown_date: board.countdown_date ?? '',
  }))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  useEscapeLayer(true, onClose)

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
      left_title: form.left_title.trim(), left_text: form.left_text,
      right_title: form.right_title.trim(), right_text: form.right_text,
      countdown_label: label || null, countdown_date: form.countdown_date || null,
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <form role="dialog" aria-modal="true" aria-labelledby="board-editor-title" onSubmit={submit}
        className="flex max-h-[92vh] w-[560px] max-w-[92vw] flex-col gap-3 overflow-auto rounded-2xl bg-panel p-5 shadow-xl">
        <h3 id="board-editor-title" className="text-lg font-semibold">编辑黑板</h3>
        <div className="grid grid-cols-2 gap-4">
          {([['left', '左'], ['right', '右']] as const).map(([side, name]) => (
            <div key={side} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                {name}黑板标题
                <input className={inputClass} value={form[`${side}_title`]} onChange={set(`${side}_title`)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {name}黑板内容
                <textarea rows={4} className={inputClass} value={form[`${side}_text`]} onChange={set(`${side}_text`)} />
              </label>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            倒计时名称
            <input className={inputClass} value={form.countdown_label} onChange={set('countdown_label')} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            倒计时日期
            <input type="date" className={inputClass} value={form.countdown_date} onChange={set('countdown_date')} />
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={toolButton} onClick={onClose}>取消</button>
          <button type="submit" className={primaryButton} disabled={saving}>保存</button>
        </div>
      </form>
    </div>
  )
}
