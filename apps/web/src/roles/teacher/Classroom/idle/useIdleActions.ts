import { useEffect, useRef, useState } from 'react'
import type { IdleAction, TeacherAction } from '@/shared/components/ClassroomMap/types'

const TICK_MS = 2600
const SIP_CHANCE = 0.15
const SIP_MS = 2400
const WEIGHTED: IdleAction[] = ['look', 'look', 'look', 'raise', 'doze', 'stretch']
const DURATION: Record<IdleAction, number> = { look: 1800, raise: 2200, doze: 4000, stretch: 1600 }
const NO_IDLE: Record<string, IdleAction> = {}

interface Options {
  ids: string[]
  enabled: boolean
  paused: boolean
  rand?: () => number
}

/** 空闲动画:每 2600ms 让一个没有动作的同学做一个小动作,偶尔老师喝水。 */
export function useIdleActions({ ids, enabled, paused, rand = Math.random }: Options) {
  const [idle, setIdle] = useState<Record<string, IdleAction>>(NO_IDLE)
  const [teacher, setTeacher] = useState<TeacherAction>('idle')
  const latest = useRef({ ids, rand })
  latest.current = { ids, rand }

  useEffect(() => {
    if (!enabled || paused) return
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const current: Record<string, IdleAction> = {}
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
    }
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const { ids: all, rand: r } = latest.current
      const free = all.filter((id) => !(id in current))
      if (free.length === 0) return
      const id = free[Math.floor(r() * free.length)]
      const action = WEIGHTED[Math.floor(r() * WEIGHTED.length)]
      current[id] = action
      setIdle({ ...current })
      later(() => {
        delete current[id]
        setIdle({ ...current })
      }, DURATION[action])
      if (r() < SIP_CHANCE) {
        setTeacher('sip')
        later(() => setTeacher('idle'), SIP_MS)
      }
    }, TICK_MS)
    return () => {
      clearInterval(interval)
      timers.forEach(clearTimeout)
      setIdle(NO_IDLE)
      setTeacher('idle')
    }
  }, [enabled, paused])

  return { idle, teacher }
}
