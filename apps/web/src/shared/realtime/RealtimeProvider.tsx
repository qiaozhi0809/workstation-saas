import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { setLoginFlash } from '@/auth/flash'
import { useAuthStore } from '@/shared/stores/auth'
import { createRealtimeClient, realtimeUrl, type RealtimeEvent } from './client'
import { RealtimeContext, type RealtimeSubscribe } from './context'

export const REVOKED_MESSAGE = '你的账号已被停用'

/** 登录后建立实时连接并把事件分发给订阅者;必须在 router 内使用 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const loggedIn = useAuthStore((s) => s.accessToken !== null)
  const subs = useRef(new Set<(e: RealtimeEvent) => void>())
  const navRef = useRef(navigate)
  useEffect(() => {
    navRef.current = navigate
  })

  const subscribe = useCallback<RealtimeSubscribe>((fn) => {
    subs.current.add(fn)
    return () => {
      subs.current.delete(fn)
    }
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    const client = createRealtimeClient({
      url: realtimeUrl(),
      getToken: () => useAuthStore.getState().accessToken,
      onEvent: (e) => {
        if (e.type === 'session.revoked') {
          setLoginFlash(REVOKED_MESSAGE)
          useAuthStore.getState().logout()
          navRef.current('/login', { replace: true })
        }
        for (const fn of [...subs.current]) {
          try {
            fn(e)
          } catch (err) {
            console.error('realtime subscriber failed', err)
          }
        }
      },
    })
    client.start()
    return () => client.stop()
  }, [loggedIn])

  return <RealtimeContext.Provider value={subscribe}>{children}</RealtimeContext.Provider>
}
