import { useEffect } from 'react'
import { applyTheme, resolveTheme, useThemeStore } from './theme'

const QUERY = '(prefers-color-scheme: dark)'

export function useApplyTheme(): void {
  const mode = useThemeStore((s) => s.mode)
  useEffect(() => {
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
    const apply = () => applyTheme(resolveTheme(mode, mql?.matches ?? false))
    apply()
    if (mode !== 'system' || !mql) return
    mql.addEventListener?.('change', apply)
    return () => mql.removeEventListener?.('change', apply)
  }, [mode])
}
