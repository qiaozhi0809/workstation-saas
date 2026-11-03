import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { reviewsApi } from '@/shared/api/reviews'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import type { FloatFx, SeatAnchor, SeatView } from '@/shared/components/ClassroomMap/types'
import * as csv from '@/shared/lib/csv'
import type { ReviewReason } from '@/shared/types/preferences'
import type { Review, ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'
import type { RosterRow } from '../attendance/exportMonth'
import Leaderboard from './Leaderboard'
import { reviewRows } from './exportReviews'
import ReviewPopover, { type ReasonPick } from './ReviewPopover'
import { signed } from './signed'
import { useReviewSubmit, type ReviewSubject } from './useReviewSubmit'

const FLOAT_MS = 1400
const UNDO_MS = 8000
const STRONG = 8
const EXPORT_PAGE = 200
const WHOLE_CLASS_REASON = '全班表现好'
const NO_REASONS: ReviewReason[] = []

/** 点评模式的座位角标:总分不为 0 才显示,|总分| ≥ 8 时强调。 */
export function reviewViews(summary: ReviewSummary | undefined): Record<string, SeatView> {
  const out: Record<string, SeatView> = {}
  for (const t of summary?.items ?? []) {
    if (t.total === 0) continue
    out[t.enrollment_id] = {
      badge: { text: signed(t.total), tone: t.total > 0 ? 'green' : 'coral', ...(Math.abs(t.total) >= STRONG ? { strong: true } : {}) },
    }
  }
  return out
}

interface Options {
  classId: string
  className: string
  enabled: boolean
  canRead: boolean
  canWrite: boolean
  reasons: ReviewReason[] | undefined
  /** 页面级当前科目(弹层、全班 +1、点名奖励共用) */
  subject: ReviewSubject
  roster: StudentSeat[]
  timezone: string | undefined
  summary: ReviewSummary | undefined
  /** 点评模式下叠在下面的外观(当天考勤) */
  overlay: Record<string, SeatView> | undefined
  /** 投屏状态:切换时关掉弹层(锚点随布局变了) */
  presenting: boolean
  /** 地图舞台容器:弹层相对它定位 */
  stageRef: RefObject<HTMLElement>
}

interface Open { seat: StudentSeat; anchor: SeatAnchor }

export function useReviewMode(o: Options) {
  const { classId, enabled, canWrite } = o
  const qc = useQueryClient()
  const [open, setOpen] = useState<Open | null>(null)
  const [board, setBoard] = useState(false)
  const [floats, setFloats] = useState<FloatFx[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const set = timers.current
    return () => { set.forEach(clearTimeout); set.clear() }
  }, [])
  useEffect(() => { if (!enabled) { setOpen(null); setBoard(false) } }, [enabled])
  useEffect(() => { setOpen(null) }, [o.presenting])

  const revoke = async (opId: string) => {
    try {
      await reviewsApi.revoke(classId, opId)
      void qc.invalidateQueries({ queryKey: ['review-summary', classId] })
      void qc.invalidateQueries({ queryKey: ['reviews', classId] })
      void qc.invalidateQueries({ queryKey: ['student-reviews', classId] })
    } catch (err) {
      toast(err instanceof Error ? err.message : '撤销失败')
    }
  }

  const pushFloats = (items: Review[]) => {
    const fx: FloatFx[] = items.map((r) => ({
      key: r.id, enrollmentId: r.enrollment_id, text: signed(r.score_delta), tone: r.score_delta > 0 ? 'plus' : 'minus',
    }))
    setFloats((cur) => [...cur, ...fx])
    const t = setTimeout(() => {
      timers.current.delete(t)
      setFloats((cur) => cur.filter((f) => !fx.some((x) => x.key === f.key)))
    }, FLOAT_MS)
    timers.current.add(t)
  }

  const { submit, pending } = useReviewSubmit(classId, o.subject.value)
  const give = (body: Parameters<typeof submit>[0], summaryText: string) => submit(body, {
    onSuccess: (items, opId) => {
      pushFloats(items)
      setOpen(null)
      toast(summaryText, { action: { label: '撤销', onClick: () => void revoke(items[0]?.op_id ?? opId) }, ms: UNDO_MS })
    },
  })

  const giveSeat = (seat: StudentSeat, p: ReasonPick) => give({
    category: 'individual', enrollment_ids: [seat.enrollment_id], reason_text: p.text, score_delta: p.delta,
  }, `已给 ${seat.name} ${p.text} ${signed(p.delta)}`)

  const giveClass = () => give(
    { category: 'whole_class', reason_text: WHOLE_CLASS_REASON, score_delta: 1 },
    `已给全班 ${WHOLE_CLASS_REASON} +1`,
  )

  const exportAll = async () => {
    if (!o.timezone) return
    try {
      const items: Review[] = []
      let cursor: string | undefined
      do {
        const page = await reviewsApi.list(classId, { cursor, limit: EXPORT_PAGE })
        items.push(...page.items)
        cursor = page.next_cursor ?? undefined
      } while (cursor)
      csv.downloadText(`${o.className}-点评.csv`, csv.toCSV(reviewRows(items, o.roster as RosterRow[], o.timezone)))
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败')
    }
  }

  const onSeatClick = (seat: StudentSeat, anchor: SeatAnchor) => {
    const r = o.stageRef.current?.getBoundingClientRect()
    setOpen({
      seat,
      anchor: { left: anchor.left - (r?.left ?? 0), top: anchor.top - (r?.top ?? 0), width: anchor.width, height: anchor.height },
    })
  }

  const views = useMemo(() => {
    const out: Record<string, SeatView> = { ...o.overlay }
    for (const [id, v] of Object.entries(reviewViews(o.summary))) out[id] = { ...out[id], ...v }
    return out
  }, [o.overlay, o.summary])

  const toolbar: ReactNode = (
    <>
      {canWrite && (
        <Button type="button" variant="outline" disabled={pending} onClick={giveClass}>全班 +1</Button>
      )}
      {o.canRead && <Button type="button" variant="outline" onClick={() => setBoard(true)}>积分榜</Button>}
      {o.canRead && <Button type="button" variant="outline" onClick={() => void exportAll()}>导出点评</Button>}
    </>
  )

  const stage = o.stageRef.current?.getBoundingClientRect()
  const popover: ReactNode = enabled && canWrite && open && (
    <ReviewPopover
      key={open.seat.enrollment_id}
      seat={open.seat}
      anchor={open.anchor}
      stage={{ w: stage?.width ?? 0, h: stage?.height ?? 0 }}
      reasons={o.reasons ?? NO_REASONS}
      subject={o.subject}
      pending={pending}
      onSubmit={(p) => giveSeat(open.seat, p)}
      onClose={() => setOpen(null)}
    />
  )
  const leaderboard: ReactNode = enabled && board && (
    <Leaderboard roster={o.roster} summary={o.summary} onClose={() => setBoard(false)} />
  )

  return {
    views, floats, toolbar, popover, leaderboard,
    onSeatClick: canWrite ? onSeatClick : undefined,
    closePopover: () => setOpen(null),
  }
}
