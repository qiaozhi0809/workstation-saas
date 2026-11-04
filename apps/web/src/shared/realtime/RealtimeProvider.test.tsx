import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { RealtimeEvent } from './client'

const h = vi.hoisted(() => ({
  made: [] as { opts: { onEvent(e: unknown): void; getToken(): string | null; url: string }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
}))
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  createRealtimeClient: (opts: { onEvent(e: unknown): void; getToken(): string | null; url: string }) => {
    const c = { opts, start: vi.fn(), stop: vi.fn() }
    h.made.push(c)
    return c
  },
}))

import { RealtimeProvider } from './RealtimeProvider'
import { useRealtimeEvent } from './useRealtimeEvent'

const user = { id: 'u', display_name: 'x', contexts: ['teacher' as const], admin_perms: [], must_change_password: false }

function Probe({ onNew }: { onNew: (e: Extract<RealtimeEvent, { type: 'notice.new' }>) => void }) {
  useRealtimeEvent('notice.new', onNew)
  return <div>probe</div>
}

const wrap = (ui: React.ReactNode) => (
  <MemoryRouter initialEntries={['/teacher']}>
    <Routes>
      <Route path="/teacher" element={<RealtimeProvider>{ui}</RealtimeProvider>} />
      <Route path="/login" element={<div>login-page</div>} />
    </Routes>
  </MemoryRouter>
)
const newEv = { type: 'notice.new', id: '1', title: 't', from_name: null, created_at: 'x' } as const

beforeEach(() => {
  h.made.length = 0
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user })
})

it('登录后创建并 start 客户端,卸载时 stop', () => {
  const { unmount } = render(wrap(<div />))
  expect(h.made).toHaveLength(1)
  expect(h.made[0].start).toHaveBeenCalled()
  expect(h.made[0].opts.getToken()).toBe('a')
  unmount()
  expect(h.made[0].stop).toHaveBeenCalled()
})

it('未登录不创建客户端;登出时 stop', () => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  render(wrap(<div />))
  expect(h.made).toHaveLength(0)
})

it('登出后 stop', () => {
  render(wrap(<div />))
  act(() => useAuthStore.setState({ accessToken: null }))
  expect(h.made[0].stop).toHaveBeenCalled()
})

it('事件分发给 useRealtimeEvent 订阅者,handler 用最新的,卸载后取消', () => {
  const a = vi.fn(), b = vi.fn()
  const { rerender } = render(wrap(<Probe onNew={a} />))
  act(() => h.made[0].opts.onEvent(newEv))
  expect(a).toHaveBeenCalledWith(newEv)
  rerender(wrap(<Probe onNew={b} />))
  act(() => h.made[0].opts.onEvent(newEv))
  expect(b).toHaveBeenCalledTimes(1)
  expect(a).toHaveBeenCalledTimes(1)
  act(() => h.made[0].opts.onEvent({ type: 'notice.recalled', id: '1' }))
  expect(b).toHaveBeenCalledTimes(1)
  rerender(wrap(<div />))
  act(() => h.made[0].opts.onEvent(newEv))
  expect(b).toHaveBeenCalledTimes(1)
})

it('session.revoked:登出并跳登录页', () => {
  render(wrap(<div />))
  act(() => h.made[0].opts.onEvent({ type: 'session.revoked' }))
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(screen.getByText('login-page')).toBeInTheDocument()
})

it('一个订阅者抛错不影响其余订阅者', () => {
  const ok = vi.fn()
  const bad = () => { throw new Error('boom') }
  render(wrap(<><Probe onNew={bad} /><Probe onNew={ok} /></>))
  act(() => h.made[0].opts.onEvent(newEv))
  expect(ok).toHaveBeenCalledWith(newEv)
})
