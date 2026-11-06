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
