import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'
import { startAuthSync } from './authSync'

const userA = { id: 'u1', display_name: 'A' }
const userB = { id: 'u2', display_name: 'B' }

function persisted(accessToken: string | null, user: unknown) {
  return JSON.stringify({ state: { accessToken, refreshToken: 'r', user }, version: 1 })
}

function fire(win: Window, init: StorageEventInit) {
  win.dispatchEvent(new StorageEvent('storage', { storageArea: win.localStorage, ...init }))
}

let win: Window
let assign: ReturnType<typeof vi.fn>
let stop: () => void

beforeEach(() => {
  assign = vi.fn()
  const target = new EventTarget()
  win = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    localStorage,
    location: { assign, pathname: '/teacher' },
  } as unknown as Window
  useAuthStore.setState({ accessToken: 'a1', refreshToken: 'r1', user: userA as never })
  stop = startAuthSync(win)
})

afterEach(() => {
  stop()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

it('logs out when another tab logs out', () => {
  fire(win, { key: 'ws-auth', newValue: persisted(null, null) })
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(assign).toHaveBeenCalledWith('/login')
})

it('treats a removed key as logged out', () => {
  fire(win, { key: 'ws-auth', newValue: null })
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(assign).toHaveBeenCalledWith('/login')
})

it('reloads when another tab switches user', () => {
  fire(win, { key: 'ws-auth', newValue: persisted('a2', userB) })
  expect(assign).toHaveBeenCalledWith('/')
})

it('stale tab does not write old user back', () => {
  // L131:另一标签换成了 B。本标签从 assign('/') 到真正卸载之间若恰好刷新了 access,persist 会把内存里的
  // 整个状态写回 ws-auth——不先 rehydrate 的话写回的是旧用户 A,把 B 的会话覆盖掉
  localStorage.setItem('ws-auth', persisted('a2', userB))
  let userAtAssign: string | undefined
  assign.mockImplementation(() => {
    userAtAssign = useAuthStore.getState().user?.id
  })
  fire(win, { key: 'ws-auth', newValue: persisted('a2', userB) })
  expect(assign).toHaveBeenCalledWith('/')
  // 跳转之前内存里已经是 B
  expect(userAtAssign).toBe('u2')
  expect(useAuthStore.getState().accessToken).toBe('a2')
  // 卸载前的一次刷新:写回去的还是 B
  useAuthStore.getState().updateAccess('a3')
  const saved = JSON.parse(localStorage.getItem('ws-auth')!).state
  expect(saved.user.id).toBe('u2')
  expect(saved.accessToken).toBe('a3')
})

it('clear in another tab logs out', () => {
  // 另一标签 localStorage.clear():storage 事件的 key 与 newValue 都是 null,ws-auth 同样没了 → 登出
  fire(win, { key: null, newValue: null })
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
  expect(assign).toHaveBeenCalledWith('/login')
  // 别的存储区被清空不算(sessionStorage)
  assign.mockClear()
  useAuthStore.setState({ accessToken: 'a1', refreshToken: 'r1', user: userA as never })
  fire(win, { key: null, newValue: null, storageArea: sessionStorage })
  expect(useAuthStore.getState().accessToken).toBe('a1')
  expect(assign).not.toHaveBeenCalled()
})

it('rehydrates on token refresh', () => {
  const spy = vi.spyOn(useAuthStore.persist, 'rehydrate').mockResolvedValue()
  fire(win, { key: 'ws-auth', newValue: persisted('a2', userA) })
  expect(spy).toHaveBeenCalledTimes(1)
  expect(assign).not.toHaveBeenCalled()
  spy.mockRestore()
})

it('ignores unrelated keys', () => {
  fire(win, { key: 'other', newValue: persisted(null, null) })
  expect(useAuthStore.getState().accessToken).toBe('a1')
  expect(assign).not.toHaveBeenCalled()
})

it('is a no-op when already logged out (no loop)', () => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  fire(win, { key: 'ws-auth', newValue: persisted(null, null) })
  fire(win, { key: 'ws-auth', newValue: null })
  expect(assign).not.toHaveBeenCalled()
})

it('survives bad JSON', () => {
  expect(() => fire(win, { key: 'ws-auth', newValue: '{nope' })).not.toThrow()
  expect(useAuthStore.getState().accessToken).toBe('a1')
  expect(assign).not.toHaveBeenCalled()
})

it('stops handling after unsubscribe', () => {
  stop()
  fire(win, { key: 'ws-auth', newValue: persisted(null, null) })
  expect(useAuthStore.getState().accessToken).toBe('a1')
})
