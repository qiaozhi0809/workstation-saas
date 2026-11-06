import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { noticesApi } from '@/shared/api/notices'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatInTz } from '@/shared/lib/date'
import { formatDeadline, localTz } from '@/shared/lib/time'
import type { AckBlockReason, AckInput, InboxItem } from '@/shared/types/admin'

const NOTE_MAX = 200

type MyAck = NonNullable<InboxItem['my_ack']>

/** can_ack=false 时的文案,按后端给的原因(L88);不再用浏览器时钟或学生列表推断。
 * readonly 也覆盖绑定已结束 / 孩子已删,所以写"毕业或离校"。 */
const BLOCKED_TEXT: Record<NonNullable<AckBlockReason>, string> = {
  recalled: '已撤回',
  closed: '已截止',
  readonly: '孩子已毕业或离校,不能回执',
  not_primary: '由主家长回执',
}

/** 收件箱里一条通知的回执区:已知晓 / 单选 / 已回执(可修改)/ 不能回执的原因 */
export default function AckForm({ item, onSubmitted }: { item: InboxItem; onSubmitted?(): void }) {
  const qc = useQueryClient()
  const [mine, setMine] = useState<MyAck | null>(item.my_ack)
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<number | null>(item.my_ack?.choice ?? null)
  const [note, setNote] = useState(item.my_ack?.note ?? '')

  const mut = useMutation({
    mutationFn: (body: AckInput) => noticesApi.ack(item.id, body),
    onError: () => {
      void qc.invalidateQueries({ queryKey: ['notices', 'inbox'] })
    },
    onSuccess: (_d, body) => {
      setMine({ choice: body.choice, note: body.note, acked_at: new Date().toISOString() })
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['notices', 'inbox'] })
      onSubmitted?.()
    },
  })

  const spec = item.ack
  if (spec.kind === 'none') return null

  const submit = (body: AckInput) => mut.mutate(body)
  const errMsg = mut.error
    ? mut.error instanceof ApiError
      ? mut.error.message
      : '提交失败,请重试'
    : null
  const reason = !item.can_ack && item.ack_block_reason ? BLOCKED_TEXT[item.ack_block_reason] : null

  const choiceLabel = (c: number | null) =>
    spec.kind === 'choice' && c !== null ? (spec.options[c] ?? '') : '已知晓'
  const canFill = item.can_ack && (mine === null || editing)

  const startEdit = () => {
    setChoice(mine?.choice ?? null)
    setNote(mine?.note ?? '')
    mut.reset()
    setEditing(true)
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2 text-sm">
      {item.ack_deadline && (
        <span className="text-xs text-muted-foreground">{formatDeadline(item.ack_deadline)}</span>
      )}

      {mine && !editing && (
        <div className="flex items-center gap-2">
          <span>
            已回执:{choiceLabel(mine.choice)},{formatInTz(mine.acked_at, localTz())}
          </span>
          {item.can_ack && (
            <Button type="button" variant="ghost" size="sm" onClick={startEdit}>
              修改
            </Button>
          )}
        </div>
      )}
      {mine && !editing && mine.note && (
        <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          留言:{mine.note}
        </span>
      )}

      {canFill && spec.kind === 'confirm' && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={mut.isPending}
            onClick={() => submit({ choice: null, note: null })}
          >
            已知晓
          </Button>
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
          )}
        </div>
      )}

      {canFill && spec.kind === 'choice' && (
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="请选择" className="flex flex-col gap-1">
            {spec.options.map((opt, i) => (
              <label key={i} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`ack-${item.id}`}
                  checked={choice === i}
                  onChange={() => setChoice(i)}
                />
                {opt}
              </label>
            ))}
          </div>
          {spec.allow_note && (
            <div className="flex flex-col gap-1">
              <Textarea
                aria-label="留言"
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <span className="self-end text-xs text-muted-foreground">
                {note.length} / {NOTE_MAX}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={choice === null || mut.isPending}
              onClick={() =>
                submit({ choice, note: spec.allow_note && note.trim() ? note.trim() : null })
              }
            >
              提交回执
            </Button>
            {editing && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                取消
              </Button>
            )}
          </div>
        </div>
      )}

      {reason && <span className="text-muted-foreground">{reason}</span>}
      {errMsg && (
        <p role="alert" className="text-destructive">
          {errMsg}
        </p>
      )}
    </div>
  )
}
