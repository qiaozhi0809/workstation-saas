import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { User } from '@/shared/types/user'
import { DRAFT_KEY, dropUpgradeDraft } from './useUpgradeDraft'

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
const hasDraft = () => window.localStorage.getItem(DRAFT_KEY) !== null

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.getState().logout()
})
afterEach(() => useAuthStore.getState().logout())

// L54(审查裁定):向导是长表单,只在"自己点退出"和"换了人"两种情况清草稿;
// 令牌失效 / 被踢 / 另一标签登出这类 user → null 不清,同一人重新登录后草稿还在(read 的 owner 校验挡住别人)
describe('upgrade draft follows the session', () => {
  it('is dropped by the explicit logout action (AdminLayout calls dropUpgradeDraft)', () => {
    login('u1')
    seedDraft('u1')
    dropUpgradeDraft()
    useAuthStore.getState().logout()
    expect(hasDraft()).toBe(false)
  })

  it('is dropped when another user signs in without an explicit logout', () => {
    login('u1')
    seedDraft('u1')
    login('u2')
    expect(hasDraft()).toBe(false)
  })

  it('is kept when the session is lost and the same user signs in again', () => {
    login('u1')
    seedDraft('u1')
    useAuthStore.getState().logout() // 令牌失效 / 被踢下线走的就是这个 store 动作
    expect(hasDraft()).toBe(true)
    login('u1')
    expect(hasDraft()).toBe(true)
  })

  it('survives a token refresh for the same user', () => {
    login('u1')
    seedDraft('u1')
    useAuthStore.getState().updateAccess('a2')
    useAuthStore.getState().setUser(user('u1'))
    expect(hasDraft()).toBe(true)
  })
})
