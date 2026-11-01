import { QueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/shared/stores/auth'
import { ApiError } from './client'

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } },
})

useAuthStore.subscribe((state, prev) => {
  if (prev.accessToken !== null && state.accessToken === null) queryClient.clear()
})
