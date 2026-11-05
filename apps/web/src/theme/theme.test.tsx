import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  THEME_KEY,
  nextThemeMode,
  readThemeMode,
  resolveTheme,
  useThemeStore,
  type ThemeMode,
} from './theme'
import { useApplyTheme } from './useTheme'
import ThemeToggle from './ThemeToggle'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ mode: 'system' })
  })

  it('falls back to system for missing, invalid or unreadable storage', () => {
    expect(readThemeMode()).toBe('system')
    localStorage.setItem(THEME_KEY, 'purple')
    expect(readThemeMode()).toBe('system')
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(readThemeMode()).toBe('system')
    } finally {
      spy.mockRestore()
    }
  })

  it('resolves and cycles modes', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(['system', 'light', 'dark'].map((m) => nextThemeMode(m as ThemeMode))).toEqual([
      'light',
      'dark',
      'system',
    ])
  })

  it('toggle cycles, applies the dark class and remembers the choice', () => {
    function Root() {
      useApplyTheme()
      return <ThemeToggle />
    }
    render(<Root />)
    fireEvent.click(screen.getByRole('button', { name: '主题:跟随系统' }))
    fireEvent.click(screen.getByRole('button', { name: '主题:浅色' }))
    expect(screen.getByRole('button', { name: '主题:深色' })).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('follows OS changes in system mode and drops .dark in light mode', () => {
    const original = window.matchMedia
    const listeners: Array<() => void> = []
    const mql = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => {
        listeners.push(fn)
      },
      removeEventListener: (_: string, fn: () => void) => {
        listeners.splice(listeners.indexOf(fn), 1)
      },
    }
    window.matchMedia = (() => mql) as unknown as typeof window.matchMedia
    try {
      function Root() {
        useApplyTheme()
        return null
      }
      render(<Root />)
      expect(document.documentElement).not.toHaveClass('dark')
      act(() => {
        mql.matches = true
        listeners.forEach((fn) => fn())
      })
      expect(document.documentElement).toHaveClass('dark')
      act(() => {
        mql.matches = false
        listeners.forEach((fn) => fn())
      })
      expect(document.documentElement).not.toHaveClass('dark')
      act(() => {
        mql.matches = true
        listeners.forEach((fn) => fn())
      })
      expect(document.documentElement).toHaveClass('dark')
      act(() => {
        useThemeStore.setState({ mode: 'light' })
      })
      expect(document.documentElement).not.toHaveClass('dark')
    } finally {
      window.matchMedia = original
    }
  })

  it('can show its label as visible text without changing the accessible name', () => {
    const { rerender } = render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: '主题:跟随系统' })).toHaveTextContent('')
    rerender(<ThemeToggle showLabel />)
    expect(screen.getByRole('button', { name: '主题:跟随系统' })).toHaveTextContent('主题:跟随系统')
  })
})
