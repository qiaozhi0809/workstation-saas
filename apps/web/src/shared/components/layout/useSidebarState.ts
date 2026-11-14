import { useCallback, useEffect, useState } from 'react'

export type SidebarScope = 'default' | 'classroom'

export const SIDEBAR_KEYS = {
  default: 'ws-sidebar',
  classroom: 'ws-sidebar:classroom',
} as const

const DRAWER_QUERY = '(min-width: 1024px)'
const EXPAND_QUERY = '(min-width: 1280px)'

/** 没有用户记录时的默认:教室页永远从 rail 开始;其他页 < 1280 宽收成 rail */
export function defaultCollapsed(width: number, scope: SidebarScope): boolean {
  if (scope === 'classroom') return true
  return width < 1280
}

function readStored(scope: SidebarScope): boolean | null {
  try {
    const v = localStorage.getItem(SIDEBAR_KEYS[scope])
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

function writeStored(scope: SidebarScope, collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEYS[scope], collapsed ? '1' : '0')
  } catch {
    // 无痕窗口 / 存储被禁:只在本次会话内生效
  }
}

/** 没有 matchMedia(测试环境)时按宽屏算 */
const matches = (query: string) => window.matchMedia?.(query).matches ?? true

/** 当前宽度折成断点代表值,只用来取默认值 */
function widthBucket(): number {
  if (matches(EXPAND_QUERY)) return 1280
  if (matches(DRAWER_QUERY)) return 1024
  return 0
}

function useBucket(): number {
  const [bucket, setBucket] = useState(widthBucket)
  useEffect(() => {
    if (!window.matchMedia) return
    const queries = [window.matchMedia(DRAWER_QUERY), window.matchMedia(EXPAND_QUERY)]
    const on = () => setBucket(widthBucket())
    on()
    queries.forEach((q) => q.addEventListener('change', on))
    return () => queries.forEach((q) => q.removeEventListener('change', on))
  }, [])
  return bucket
}

export function useSidebarState(scope: SidebarScope): {
  mode: 'panel' | 'drawer'
  collapsed: boolean
  toggle(): void
  drawerOpen: boolean
  setDrawerOpen(open: boolean): void
} {
  const bucket = useBucket()
  // 记录带着 scope 一起存:scope 变了(教师端进出教室页)的那一次渲染就读新 scope 自己的记录
  const [record, setRecord] = useState(() => ({ scope, value: readStored(scope) }))
  const stored = record.scope === scope ? record.value : readStored(scope)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mode = bucket >= 1024 ? 'panel' : 'drawer'

  const collapsed = mode === 'drawer' ? false : (stored ?? defaultCollapsed(bucket, scope))

  const toggle = useCallback(() => {
    if (mode === 'drawer') {
      setDrawerOpen((o) => !o)
      return
    }
    const next = !collapsed
    writeStored(scope, next)
    setRecord({ scope, value: next })
  }, [mode, collapsed, scope])

  // 回到宽屏时收起抽屉
  useEffect(() => {
    if (mode === 'panel') setDrawerOpen(false)
  }, [mode])

  return { mode, collapsed, toggle, drawerOpen, setDrawerOpen }
}

/** `[` 折叠 / 展开:输入框、组字、带修饰键、长按、全屏时都不触发 */
export function isSidebarShortcut(e: KeyboardEvent): boolean {
  if (e.key !== '[') return false
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return false
  if (document.fullscreenElement) return false
  const t = e.target
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return false
  return true
}
