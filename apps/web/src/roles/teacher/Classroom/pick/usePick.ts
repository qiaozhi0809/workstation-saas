import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/shared/hooks/useReducedMotion'
import { useReviewSubmit } from '../review/useReviewSubmit'
import { choosePick, spinDelays } from './pickLogic'

export type PickState = 'idle' | 'spinning' | 'picked' | 'empty'

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

/** "回答得好 +1":与点评共用提交逻辑(同步守卫、结果不明时重试沿用 op_id、当前科目),成功后回调。 */
export function usePickReward(classId: string, subject: string, onDone: () => void) {
  const { submit, pending } = useReviewSubmit(classId, subject)
  const reward = (enrollmentId: string) => submit(
    { category: 'individual', enrollment_ids: [enrollmentId], reason_text: '回答问题', score_delta: 1 },
    { onSuccess: onDone },
  )
  return { reward, pending }
}
