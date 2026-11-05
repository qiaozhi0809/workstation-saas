import { afterEach, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import { ApiError } from './client'
import { queryClient, shouldRetry } from './queryClient'

afterEach(() => {
  queryClient.clear()
  useAuthStore.getState().logout()
  useTeacherStore.setState({ classId: null })
  localStorage.clear()
})

it('does not retry 4xx ApiError, retries other errors once', () => {
  expect(shouldRetry(0, new ApiError(403, 'FORBIDDEN', 'no'))).toBe(false)
  expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', 'no'))).toBe(false)
  expect(shouldRetry(0, new ApiError(500, 'INTERNAL', 'x'))).toBe(true)
  expect(shouldRetry(1, new ApiError(500, 'INTERNAL', 'x'))).toBe(false)
  expect(shouldRetry(0, new TypeError('network'))).toBe(true)
  expect(shouldRetry(1, new TypeError('network'))).toBe(false)
})

it('uses a 30s staleTime', () => {
  expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000)
})

it('clears the query cache when the access token goes from set to null', () => {
  useAuthStore
    .getState()
    .setTokens('a', 'r', {
      id: 'u',
      display_name: 't',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
    })
  queryClient.setQueryData(['k'], 1)
  useAuthStore.getState().updateAccess('b')
  expect(queryClient.getQueryData(['k'])).toBe(1)
  useAuthStore.getState().logout()
  expect(queryClient.getQueryData(['k'])).toBeUndefined()
})

it('resets the selected class on logout', () => {
  useAuthStore
    .getState()
    .setTokens('a', 'r', {
      id: 'u',
      display_name: 't',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
    })
  useTeacherStore.setState({ classId: 'c1' })
  useAuthStore.getState().logout()
  expect(useTeacherStore.getState().classId).toBeNull()
})

it('clears the cache and class when the user changes without logout', () => {
  useAuthStore
    .getState()
    .setTokens('a', 'r', {
      id: 'u1',
      display_name: 't',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
    })
  queryClient.setQueryData(['k'], 1)
  useTeacherStore.setState({ classId: 'c1' })
  useAuthStore
    .getState()
    .setTokens('b', 'r2', {
      id: 'u2',
      display_name: 't2',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
    })
  expect(queryClient.getQueryData(['k'])).toBeUndefined()
  expect(useTeacherStore.getState().classId).toBeNull()
})
