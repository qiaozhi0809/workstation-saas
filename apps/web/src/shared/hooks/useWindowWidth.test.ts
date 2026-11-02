import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useWindowWidth } from './useWindowWidth'

const WIDTH = window.innerWidth
afterEach(() => { window.innerWidth = WIDTH })

it('starts at the current window width and follows resize', () => {
  const { result } = renderHook(() => useWindowWidth())
  expect(result.current).toBe(WIDTH)
  act(() => {
    window.innerWidth = 800
    window.dispatchEvent(new Event('resize'))
  })
  expect(result.current).toBe(800)
})
