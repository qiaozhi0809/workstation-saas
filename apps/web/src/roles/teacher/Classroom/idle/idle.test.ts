import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useIdleActions } from './useIdleActions'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('animates one student at a time and clears after the action ends', () => {
  const rand = vi.fn().mockReturnValue(0)
  const { result } = renderHook(() => useIdleActions({ ids: ['e1', 'e2'], enabled: true, paused: false, rand }))
  act(() => vi.advanceTimersByTime(2600))
  expect(result.current.idle).toEqual({ e1: 'look' })
  act(() => vi.advanceTimersByTime(1800))
  expect(result.current.idle).toEqual({})
  expect(result.current.teacher).toBe('sip')
})

it('stays still when disabled, paused or hidden', () => {
  const run = (enabled: boolean, paused: boolean) =>
    renderHook(() => useIdleActions({ ids: ['e1'], enabled, paused, rand: () => 0 })).result
  const off = run(false, false), held = run(true, true)
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  const hidden = run(true, false)
  act(() => vi.advanceTimersByTime(10_000))
  expect([off.current.idle, held.current.idle, hidden.current.idle]).toEqual([{}, {}, {}])
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

it('clears running actions when paused and stops its timers on unmount', () => {
  const props = { ids: ['e1'], enabled: true, paused: false, rand: () => 0 }
  const { result, rerender, unmount } = renderHook((p) => useIdleActions(p), { initialProps: props })
  act(() => vi.advanceTimersByTime(2600))
  expect(result.current.idle).toEqual({ e1: 'look' })
  rerender({ ...props, paused: true })
  expect(result.current.idle).toEqual({})
  expect(result.current.teacher).toBe('idle')
  rerender(props)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
