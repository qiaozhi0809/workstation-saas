import { readFileSync } from 'node:fs'

// vitest 会把 CSS 模块(含 ?raw)替换成空串,所以直接读文件(vitest 的 cwd 是 apps/web)
const css = readFileSync('src/theme/index.css', 'utf8')

type HSL = [number, number, number]

function parseTheme(source: string, theme: 'light' | 'dark'): Record<string, HSL> {
  const selector = theme === 'light' ? ':root' : '.dark'
  const start = source.indexOf(`${selector} {`)
  const end = source.indexOf('}', start)
  const block = source.slice(start, end)
  const out: Record<string, HSL> = {}
  for (const m of block.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]
  }
  return out
}

function toRgb([h, s, l]: HSL): [number, number, number] {
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const contrast = (fg: HSL, bg: HSL) => ratio(toRgb(fg), toRgb(bg))

function tint(fg: HSL, bg: HSL, alpha: number): [number, number, number] {
  const f = toRgb(fg)
  const b = toRgb(bg)
  return [0, 1, 2].map((i) => f[i] * alpha + b[i] * (1 - alpha)) as [number, number, number]
}

const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'], ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'], ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'],
  ...(['destructive', 'success', 'warning', 'info'] as const).flatMap((t): [string, string][] => [
    [t, 'background'], [t, 'muted'], [`${t}-foreground`, t],
  ]),
]
const STATUS = ['destructive', 'success', 'warning', 'info']

for (const theme of ['light', 'dark'] as const) {
  describe(`${theme} tokens`, () => {
    const t = parseTheme(css, theme)
    it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
    })
    it.each(STATUS)('%s text on its 10%% tint (over background and muted) is at least 4.5:1', (s) => {
      expect(ratio(toRgb(t[s]), tint(t[s], t.background, 0.1))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(toRgb(t[s]), tint(t[s], t.muted, 0.1))).toBeGreaterThanOrEqual(4.5)
    })
    it('chart-4 (lightest series colour) on background is at least 3:1', () => {
      expect(contrast(t['chart-4'], t.background)).toBeGreaterThanOrEqual(3)
    })
    it('ring on background is at least 3:1', () => {
      expect(contrast(t.ring, t.background)).toBeGreaterThanOrEqual(3)
    })
  })
}
