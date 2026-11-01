import { afterEach, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { ApiError } from './client'
import { queryClient, shouldRetry } from './queryClient'

afterEach(() => {
  queryClient.clear()
  useAuthStore.getState().logout()
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
  useAuthStore.getState().setTokens('a', 'r', { id: 'u', display_name: 't' })
  queryClient.setQueryData(['k'], 1)
  useAuthStore.getState().updateAccess('b')
  expect(queryClient.getQueryData(['k'])).toBe(1)
  useAuthStore.getState().logout()
  expect(queryClient.getQueryData(['k'])).toBeUndefined()
})
