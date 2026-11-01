import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { newOpId } from '@/shared/api/opId'
import { reviewsApi } from '@/shared/api/reviews'
import { toast } from '@/shared/components/Toast'
import { choosePick, spinDelays } from './pickLogic'

export type PickState = 'idle' | 'spinning' | 'picked' | 'empty'

/** 读取系统的"减少动态效果"偏好(没有 matchMedia 的环境视为未开启)。 */
export const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Options {
  pool: string[]
  rand?: () => number
  /** 每次 start 时读取 */
  reducedMotion?: () => boolean
}

export function usePick({ pool, rand = Math.random, reducedMotion = prefersReducedMotion }: Options) {
  const [state, setState] = useState<PickState>('idle')
  const [spotlightId, setSpotlightId] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  // 冷却记录只存在本次页面生命周期内(刷新清零)
  const recent = useRef<string[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])
  useEffect(() => clearTimers, [clearTimers])

  const start = () => {
    clearTimers()
    setSpotlightId(null)
    setPickedId(null)
    const chosen = choosePick(pool, recent.current, rand)
    recent.current = chosen.recent
    if (chosen.id === null) { setState('empty'); return }
    const id = chosen.id
    if (reducedMotion()) { setPickedId(id); setState('picked'); return }
    setState('spinning')
    const delays = spinDelays()
    let at = 0
    delays.forEach((d, i) => {
      at += d
      const last = i === delays.length - 1
      timers.current.push(setTimeout(() => {
        if (last) { setSpotlightId(id); setPickedId(id); setState('picked') }
        else setSpotlightId(pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))])
      }, at))
    })
  }

  const close = () => {
    clearTimers()
    setState('idle')
    setSpotlightId(null)
    setPickedId(null)
  }

  return { state, spotlightId, pickedId, start, close }
}

/** "回答得好 +1":一次点击一个 op_id,请求期间忽略重复点击,成功后失效点评缓存并回调。 */
export function usePickReward(classId: string, onDone: () => void) {
  const qc = useQueryClient()
  const inflight = useRef(false)
  const post = useMutation({
    mutationFn: (enrollmentId: string) => reviewsApi.create(classId, {
      op_id: newOpId(), category: 'individual', enrollment_ids: [enrollmentId], reason_text: '回答问题', score_delta: 1,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review-summary', classId] })
      void qc.invalidateQueries({ queryKey: ['reviews', classId] })
      onDone()
    },
    onError: (err) => toast(err.message),
    onSettled: () => { inflight.current = false },
  })
  const reward = (enrollmentId: string) => {
    if (inflight.current) return
    inflight.current = true
    post.mutate(enrollmentId)
  }
  return { reward, pending: post.isPending }
}
