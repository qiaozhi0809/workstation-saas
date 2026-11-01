import type { Tone } from '../types'

export const GROUP_COLORS = ['#3fb8a9', '#f08a5d', '#8b7cf6', '#f4b740', '#4c9be8', '#7bc96f'] as const
export const groupColor = (g: number) => GROUP_COLORS[((g % 6) + 6) % 6]

export const INK = { hair: '#3a2e2a', skin: '#f7d5bd', cheek: '#f4a9a0', outline: '#fffaf3' } as const
export const ROOM = {
  floor: '#f3ebe0', plank: '#e8dccb', wall: '#eef2f6', trim: '#d9e1ea', desk: '#fdfbf7', deskEdge: '#e7ddd0',
  board: '#2f4a3f', chalk: '#eef5ea', screen: '#3d5a80', gold: '#f2c14e', window: '#d6ecf5',
} as const
export const TONES: Record<Tone, { fg: string; bg: string }> = {
  amber: { fg: '#b7791f', bg: '#fdf1d8' },
  red: { fg: '#c0392b', bg: '#fbe3e0' },
  blue: { fg: '#2b6cb0', bg: '#e3eefb' },
  green: { fg: '#2f855a', bg: '#e2f4ea' },
  coral: { fg: '#d1603d', bg: '#fde7df' },
  gray: { fg: '#5c5c5a', bg: '#efefed' },
}
export const TEACHER_COLORS = { cardigan: '#c9785d', vest: '#5d7c9e' } as const

export const SHADOW_ID = 'crShadow'
export const SHADOW = `url(#${SHADOW_ID})`

// 线性混色:t = 0 → a,t = 1 → b(用于同色系的深浅纸片)
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
