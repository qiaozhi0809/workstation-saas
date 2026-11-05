import { useContext, useEffect, useRef } from 'react'
import type { RealtimeEvent } from './client'
import { RealtimeContext } from './context'

/** 在 RealtimeProvider 内订阅指定类型的事件;handler 用 ref 保持最新,卸载时取消。Provider 之外调用为空操作。 */
export function useRealtimeEvent<T extends RealtimeEvent['type']>(
  type: T,
  handler: (e: Extract<RealtimeEvent, { type: T }>) => void,
): void {
  const subscribe = useContext(RealtimeContext)
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!subscribe) return
    return subscribe((e) => {
      if (e.type === type) ref.current(e as Extract<RealtimeEvent, { type: T }>)
    })
  }, [subscribe, type])
}
