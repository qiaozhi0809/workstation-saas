import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { User } from '@/shared/types/user'
import { DRAFT_KEY } from './useUpgradeDraft'

const user = (id: string): User => ({
  id,
  display_name: '张主任',
  contexts: ['admin'],
  admin_perms: ['year.upgrade'],
  must_change_password: false,
  password_change_reason: null,
})
const login = (id: string) =>
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: user(id) })
const seedDraft = (owner: string) =>
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({ v: 2, owner, step: 'year', year: {}, plan: null, ui: {} }),
  )

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.getState().logout()
})
afterEach(() => useAuthStore.getState().logout())

// 草稿模块订阅登录态(L54):登出 / 换号时清掉 localStorage 里的草稿,不靠下次读取时的 owner 校验
describe('upgrade draft follows the session', () => {
  it('is dropped on logout', () => {
    login('u1')
    seedDraft('u1')
    useAuthStore.getState().logout()
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('is dropped when another user signs in without an explicit logout', () => {
    login('u1')
    seedDraft('u1')
    login('u2')
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('survives a token refresh for the same user', () => {
    login('u1')
    seedDraft('u1')
    useAuthStore.getState().updateAccess('a2')
    useAuthStore.getState().setUser(user('u1'))
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull()
  })
})
