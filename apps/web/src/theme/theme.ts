import { create } from 'zustand'

export type ThemeMode = 'system' | 'light' | 'dark'
export const THEME_KEY = 'ws-theme'

export function readThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    // storage 不可用时只在本次会话生效
  }
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

export function applyTheme(resolved: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  // Arc 用 data-theme 切暗色,shadcn 用 .dark 类:两套开关同步
  if (resolved === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
}

const ORDER: ThemeMode[] = ['system', 'light', 'dark']

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()((set) => ({
  mode: readThemeMode(),
  setMode: (mode) => {
    writeThemeMode(mode)
    set({ mode })
  },
}))
