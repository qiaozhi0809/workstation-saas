import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDEBAR_KEYS,
  defaultCollapsed,
  isSidebarShortcut,
  useSidebarState,
} from './useSidebarState'

/** 按宽度模拟 matchMedia('(min-width: Npx)') */
function mockWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

const key = (init: KeyboardEventInit, target?: Element) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, ...init })
  if (target) Object.defineProperty(e, 'target', { value: target })
  return e
}

beforeEach(() => {
  localStorage.clear()
  mockWidth(1440)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('defaultCollapsed', () => {
  it('defaults by width and scope', () => {
    expect(defaultCollapsed(1440, 'default')).toBe(false)
    expect(defaultCollapsed(1280, 'default')).toBe(false)
    expect(defaultCollapsed(1279, 'default')).toBe(true)
    expect(defaultCollapsed(1920, 'classroom')).toBe(true)
  })
})

describe('useSidebarState', () => {
  it('persists per scope', () => {
    const { result } = renderHook(() => useSidebarState('default'))
    expect(result.current.collapsed).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem(SIDEBAR_KEYS.default)).toBe('1')
    expect(localStorage.getItem(SIDEBAR_KEYS.classroom)).toBeNull()
    act(() => result.current.toggle())
    expect(localStorage.getItem('ws-sidebar')).toBe('0')
  })

  it('reads the stored value for its own scope', () => {
    localStorage.setItem('ws-sidebar:classroom', '0')
    const { result } = renderHook(() => useSidebarState('classroom'))
    expect(result.current.collapsed).toBe(false)
  })

  it('classroom is a rail until the user expands it', () => {
    const { result } = renderHook(() => useSidebarState('classroom'))
    expect(result.current.collapsed).toBe(true)
  })

  it('survives storage errors', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('x')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x')
    })
    const { result } = renderHook(() => useSidebarState('default'))
    expect(result.current.collapsed).toBe(false)
    expect(() => act(() => result.current.toggle())).not.toThrow()
    expect(result.current.collapsed).toBe(true)
  })

  it('drawer below 1024', () => {
    mockWidth(800)
    const { result } = renderHook(() => useSidebarState('default'))
    expect(result.current.mode).toBe('drawer')
    expect(result.current.drawerOpen).toBe(false)
    act(() => result.current.setDrawerOpen(true))
    expect(result.current.drawerOpen).toBe(true)
  })

  it('re-reads the record when the scope changes', () => {
    localStorage.setItem('ws-sidebar', '0')
    localStorage.setItem('ws-sidebar:classroom', '1')
    const { result, rerender } = renderHook(({ scope }) => useSidebarState(scope), {
      initialProps: { scope: 'classroom' as 'default' | 'classroom' },
    })
    expect(result.current.collapsed).toBe(true)
    rerender({ scope: 'default' })
    expect(result.current.collapsed).toBe(false)
  })

  it('panel from 1024', () => {
    mockWidth(1100)
    const { result } = renderHook(() => useSidebarState('default'))
    expect(result.current.mode).toBe('panel')
    expect(result.current.collapsed).toBe(true)
  })
})

describe('isSidebarShortcut', () => {
  it('ignores [ while composing or typing', () => {
    expect(isSidebarShortcut(key({ key: '[' }))).toBe(true)
    expect(isSidebarShortcut(key({ key: '[', isComposing: true }))).toBe(false)
    expect(isSidebarShortcut(key({ key: '[', ctrlKey: true }))).toBe(false)
    expect(isSidebarShortcut(key({ key: '[', metaKey: true }))).toBe(false)
    expect(isSidebarShortcut(key({ key: '[', altKey: true }))).toBe(false)
    expect(isSidebarShortcut(key({ key: '[', repeat: true }))).toBe(false)
    expect(isSidebarShortcut(key({ key: ']' }))).toBe(false)
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isSidebarShortcut(key({ key: '[' }, document.createElement(tag)))).toBe(false)
    }
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(isSidebarShortcut(key({ key: '[' }, editable))).toBe(false)
    const inside = document.createElement('span')
    editable.appendChild(inside)
    expect(isSidebarShortcut(key({ key: '[' }, inside))).toBe(false)
  })

  it('ignores [ in fullscreen', () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.body,
      configurable: true,
    })
    try {
      expect(isSidebarShortcut(key({ key: '[' }))).toBe(false)
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement')
    }
  })
})
