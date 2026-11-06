import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { Toaster, toast } from '@/shared/components/Toast'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import AppShell from '@/shared/components/layout/AppShell'
import { switchTargets } from '@/shared/components/layout/switchTargets'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent'
import { useAuthStore } from '@/shared/stores/auth'
import ThemeToggle from '@/theme/ThemeToggle'
import ChildSwitcher from './ChildSwitcher'
import FirstVisit from './FirstVisit'
import ParentNav from './ParentNav'
import { ChildContext, useChild, useChildState } from './useChild'

const QUERY = '(min-width: 768px)'

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(QUERY).matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

export default function ParentLayout() {
  return (
    <RealtimeProvider>
      <ParentShell />
    </RealtimeProvider>
  )
}

/** 家长端只订阅事件、不判权:推给谁由后端决定 */
function ParentShell() {
  const qc = useQueryClient()
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notices', 'inbox'] })
  useRealtimeEvent('notice.new', (e) => {
    toast(`新通知:${e.title}`)
    refresh()
  })
  useRealtimeEvent('notice.recalled', refresh)
  useRealtimeEvent('reconnected', refresh)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const wide = useWide()
  const state = useChildState()
  const { list, children, child, select } = state

  const logout = () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    navigate('/login', { replace: true })
  }

  let body
  if (list.isError)
    body = (
      <ErrorState
        title="孩子列表加载失败"
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    )
  else if (!child) {
    body = list.isPending ? (
      <LoadingState />
    ) : (
      <EmptyState title="还没有绑定孩子,请联系班主任" className="justify-center p-6" />
    )
  } else
    body = (
      <ChildContext.Provider value={state}>
        <Outlet />
      </ChildContext.Provider>
    )

  return (
    <AppShell
      home="/parent"
      context={
        child && (
          <>
            <ChildSwitcher items={children} current={child} onSelect={select} />
            <Link
              to={{
                pathname: '/parent/profile',
                search: `?child=${encodeURIComponent(child.student_id)}`,
              }}
              aria-label="档案"
              title="档案"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </Link>
          </>
        )
      }
      nav={child && wide ? <ParentNav placement="top" childId={child.student_id} /> : undefined}
      actions={
        <>
          <ThemeToggle />
          <AccountMenu
            name={user?.display_name}
            onLogout={logout}
            switchTo={switchTargets(user?.contexts, 'parent')}
            preferences={false}
          />
        </>
      }
      overlays={
        <>
          {child && !wide && <ParentNav placement="bottom" childId={child.student_id} />}
          <Toaster />
        </>
      }
    >
      <FirstVisit />
      {body}
    </AppShell>
  )
}

/** /parent 本身:等孩子确定后带着 ?child= 跳到今日 */
export function ParentIndex() {
  const { child } = useChild()
  if (!child) return null
  return (
    <Navigate
      to={{ pathname: '/parent/today', search: `?child=${encodeURIComponent(child.student_id)}` }}
      replace
    />
  )
}
