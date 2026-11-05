import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion'

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

function fakeMatchMedia(initial: boolean) {
  let listener: (() => void) | null = null
  const mql = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => {
      listener = fn
    },
    removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql)
  return {
    set(v: boolean) {
      mql.matches = v
      listener?.()
    },
  }
}

it('reads the reduced-motion preference and treats a missing matchMedia as off', () => {
  ;(window as { matchMedia?: unknown }).matchMedia = undefined
  expect(prefersReducedMotion()).toBe(false)
  fakeMatchMedia(true)
  expect(prefersReducedMotion()).toBe(true)
  expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
})

it('follows changes of the preference', () => {
  const mm = fakeMatchMedia(false)
  const { result } = renderHook(() => useReducedMotion())
  expect(result.current).toBe(false)
  act(() => mm.set(true))
  expect(result.current).toBe(true)
})
