import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useRealtimeEvent } from './useRealtimeEvent'

it('在 Provider 之外使用不报错也不触发', () => {
  const h = vi.fn()
  const { unmount } = renderHook(() => useRealtimeEvent('reconnected', h))
  unmount()
  expect(h).not.toHaveBeenCalled()
})
