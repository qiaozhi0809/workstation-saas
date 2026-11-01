import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { newOpId } from '@/shared/api/opId'
import { ApiError } from '@/shared/api/client'
import { reviewsApi } from '@/shared/api/reviews'
import { toast } from '@/shared/components/Toast'
import type { FloatFx, SeatAnchor, SeatView } from '@/shared/components/ClassroomMap/types'
import * as csv from '@/shared/lib/csv'
import type { ReviewReason } from '@/shared/types/preferences'
import type { Review, ReviewCreate, ReviewSummary } from '@/shared/types/review'
import type { StudentSeat } from '@/shared/types/student'
import type { RosterRow } from '../attendance/exportMonth'
import { toolButton } from '../Toolbar'
import Leaderboard from './Leaderboard'
import { reviewRows } from './exportReviews'
import ReviewPopover, { type ReasonPick } from './ReviewPopover'
import { signed } from './signed'

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
  subjects: string[]
  roster: StudentSeat[]
  timezone: string | undefined
  summary: ReviewSummary | undefined
  /** 点评模式下叠在下面的外观(当天考勤) */
  overlay: Record<string, SeatView> | undefined
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
  // 同步守卫:第二次点击发生在 React 重渲染(按钮禁用)之前也不会再发请求
  const inflight = useRef(false)

  useEffect(() => {
    const set = timers.current
    return () => { set.forEach(clearTimeout); set.clear() }
  }, [])
  useEffect(() => { if (!enabled) { setOpen(null); setBoard(false) } }, [enabled])

  const revoke = async (opId: string) => {
    try {
      await reviewsApi.revoke(classId, opId)
      void qc.invalidateQueries({ queryKey: ['review-summary', classId] })
      void qc.invalidateQueries({ queryKey: ['reviews', classId] })
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

  const post = useMutation({
    mutationFn: (body: ReviewCreate) => reviewsApi.create(classId, body),
  })

  /** 一次用户操作 = 一个 op_id;进行中的请求期间忽略其余提交。 */
  const submit = (body: Omit<ReviewCreate, 'op_id'>, summaryText: string) => {
    if (inflight.current) return
    inflight.current = true
    const op_id = newOpId()
    post.mutate({ op_id, ...body }, {
      onSuccess: (res) => {
        void qc.invalidateQueries({ queryKey: ['review-summary', classId] })
        void qc.invalidateQueries({ queryKey: ['reviews', classId] })
        pushFloats(res.items)
        setOpen(null)
        toast(summaryText, { action: { label: '撤销', onClick: () => void revoke(res.items[0]?.op_id ?? op_id) }, ms: UNDO_MS })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'NO_TARGETS') toast('今天全班都请假了')
        else toast(err.message)
      },
      onSettled: () => { inflight.current = false },
    })
  }

  const giveSeat = (seat: StudentSeat, p: ReasonPick) => submit({
    category: 'individual', enrollment_ids: [seat.enrollment_id],
    reason_text: p.text, score_delta: p.delta, ...(p.subject ? { subject: p.subject } : {}),
  }, `已给 ${seat.name} ${p.text} ${signed(p.delta)}`)

  const giveClass = () => submit(
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
        <button type="button" className={toolButton} disabled={post.isPending} onClick={giveClass}>全班 +1</button>
      )}
      {o.canRead && <button type="button" className={toolButton} onClick={() => setBoard(true)}>积分榜</button>}
      {o.canRead && <button type="button" className={toolButton} onClick={() => void exportAll()}>导出点评</button>}
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
      subjects={o.subjects}
      pending={post.isPending}
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
