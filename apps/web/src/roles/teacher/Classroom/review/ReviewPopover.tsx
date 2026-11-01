import { useRef, useState } from 'react'
import { placeCard } from '@/shared/components/ClassroomMap/placeCard'
import type { SeatAnchor } from '@/shared/components/ClassroomMap/types'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import type { ReviewReason } from '@/shared/types/preferences'
import type { StudentSeat } from '@/shared/types/student'
import { signed } from './signed'
import type { ReviewSubject } from './useReviewSubmit'

const CARD = { w: 288, h: 380 }

export interface ReasonPick { text: string; delta: number }

const chip =
  'rounded-lg border border-line-2 px-2 py-1 text-sm hover:bg-fill disabled:cursor-not-allowed disabled:opacity-50'

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
      className="absolute z-20 flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <strong className="text-sm">{seat.name}</strong>
        <button type="button" aria-label="关闭" className="text-ink-2" onClick={onClose}>×</button>
      </div>
      {subject.subjects.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          科目
          <select value={subject.value} disabled={pending} onChange={(e) => subject.set(e.target.value)}
            className="flex-1 rounded-lg border border-line-2 px-2 py-1">
            {!subject.required && <option value="">不指定</option>}
            {subject.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" className={chip} disabled={pending} onClick={() => submit({ text: '表现好', delta: 1 })}>+1</button>
        <button type="button" className={chip} disabled={pending} onClick={() => submit({ text: '需改进', delta: -1 })}>-1</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={`${r.text}${r.delta}`} type="button" disabled={pending}
            className={`${chip} ${r.delta > 0 ? 'text-green' : 'text-red'}`}
            onClick={() => submit(r)}>
            {`${r.text} ${signed(r.delta)}`}
          </button>
        ))}
      </div>
      <form className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); if (customOk && !pending) submit({ text: customText, delta: customDelta }) }}>
        <input aria-label="理由" value={text} maxLength={20} disabled={pending} placeholder="理由"
          onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line-2 px-2 py-1 text-sm" />
        <input aria-label="分值" type="number" min={-10} max={10} value={delta} disabled={pending} placeholder="分值"
          onChange={(e) => setDelta(e.target.value)} className="w-16 rounded-lg border border-line-2 px-2 py-1 text-sm" />
        <button type="submit" className={chip} disabled={pending || !customOk}>确定</button>
      </form>
    </div>
  )
}
