import { createContext } from 'react'
import type { RealtimeEvent } from './client'

/** 订阅所有事件,返回取消函数;Provider 之外为 null */
export type RealtimeSubscribe = (fn: (e: RealtimeEvent) => void) => () => void
export const RealtimeContext = createContext<RealtimeSubscribe | null>(null)
