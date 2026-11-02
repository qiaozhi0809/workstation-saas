import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { placeCard } from '@/shared/components/ClassroomMap/placeCard'
import type { SeatAnchor } from '@/shared/components/ClassroomMap/types'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { scoreTone, TONE_TEXT } from '@/shared/lib/tone'
import type { ReviewReason } from '@/shared/types/preferences'
import type { StudentSeat } from '@/shared/types/student'
import { signed } from './signed'
import type { ReviewSubject } from './useReviewSubmit'

const CARD = { w: 288, h: 380 }

// outline 按钮悬停时会换成 accent 文字色,这里让理由按钮悬停时仍保持加分 / 扣分色
const HOVER_TONE: Partial<Record<ReturnType<typeof scoreTone>, string>> = {
  success: 'hover:text-success',
  danger: 'hover:text-destructive',
}

export interface ReasonPick { text: string; delta: number }

/** 点评弹层:位于座位旁。anchor 是相对舞台的坐标(点击瞬间的快照),stage 是舞台尺寸。 */
export default function ReviewPopover({ seat, anchor, stage, reasons, subject, pending, onSubmit, onClose }: {
  seat: StudentSeat
  anchor: SeatAnchor
  stage: { w: number; h: number }
  reasons: ReviewReason[]
  /** 页面级当前科目;在这里改了,下次打开弹层、全班 +1、点名奖励都沿用 */
  subject: ReviewSubject
  pending: boolean
  onSubmit(pick: ReasonPick): void
  onClose(): void
}) {
  useEscapeLayer(true, onClose)
  const [text, setText] = useState('')
  const [delta, setDelta] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const pos = placeCard(anchor, CARD, stage)

  const submit = (p: ReasonPick) => onSubmit({ text: p.text, delta: p.delta })
  const customText = text.trim()
  const customDelta = Number(delta)
  const customOk = customText.length >= 1 && customText.length <= 20 && delta.trim() !== ''
    && Number.isInteger(customDelta) && customDelta !== 0 && customDelta >= -10 && customDelta <= 10

  return (
    <div ref={ref} role="dialog" aria-label={`点评 ${seat.name}`}
      style={{ left: pos.left, top: pos.top, width: CARD.w }}
      className="absolute z-20 flex flex-col gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="flex items-center justify-between">
        <strong className="text-sm">{seat.name}</strong>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭" className="h-7 w-7" onClick={onClose}>
          <X />
        </Button>
      </div>
      {subject.subjects.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          科目
          <NativeSelect value={subject.value} disabled={pending} onChange={(e) => subject.set(e.target.value)}
            className="h-8 flex-1">
            {!subject.required && <option value="">不指定</option>}
            {subject.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => submit({ text: '表现好', delta: 1 })}>+1</Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => submit({ text: '需改进', delta: -1 })}>-1</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <Button key={`${r.text}${r.delta}`} type="button" variant="outline" size="sm" disabled={pending}
            className={`${TONE_TEXT[scoreTone(r.delta)]} ${HOVER_TONE[scoreTone(r.delta)] ?? ''}`}
            onClick={() => submit(r)}>
            {`${r.text} ${signed(r.delta)}`}
          </Button>
        ))}
      </div>
      <form className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); if (customOk && !pending) submit({ text: customText, delta: customDelta }) }}>
        <Input aria-label="理由" value={text} maxLength={20} disabled={pending} placeholder="理由"
          onChange={(e) => setText(e.target.value)} className="h-8 min-w-0 flex-1" />
        <Input aria-label="分值" type="number" min={-10} max={10} value={delta} disabled={pending} placeholder="分值"
          onChange={(e) => setDelta(e.target.value)} className="h-8 w-16 px-2" />
        <Button type="submit" size="sm" disabled={pending || !customOk}>确定</Button>
      </form>
    </div>
  )
}
