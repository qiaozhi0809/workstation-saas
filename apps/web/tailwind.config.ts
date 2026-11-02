import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const token = (name: string) => `hsl(var(--${name}))`
const pair = (name: string) => ({ DEFAULT: token(name), foreground: token(`${name}-foreground`) })
// 迁移期别名(Task 16 删除):旧色名指向新令牌,未迁移的页面也能跟随深色模式
const soft = (name: string) => `hsl(var(--${name}) / 0.1)`

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: token('border'), input: token('input'), ring: token('ring'),
        background: token('background'), foreground: token('foreground'),
        primary: pair('primary'), secondary: pair('secondary'), muted: pair('muted'), accent: pair('accent'),
        popover: pair('popover'), card: pair('card'),
        destructive: pair('destructive'), success: pair('success'), warning: pair('warning'), info: pair('info'),
        ink: { DEFAULT: token('foreground'), 2: token('muted-foreground'), 3: token('muted-foreground') },
        line: { DEFAULT: token('border'), 2: token('input') },
        panel: token('card'),
        side: token('muted'),
        fill: { DEFAULT: token('muted'), 2: token('accent') },
        blue: { DEFAULT: token('info'), soft: soft('info') },
        red: { DEFAULT: token('destructive'), soft: soft('destructive') },
        amber: { DEFAULT: token('warning'), soft: soft('warning') },
        green: { DEFAULT: token('success'), soft: soft('success') },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      fontFamily: {
        sans: ['"PingFang SC"', '"HarmonyOS Sans SC"', '"MiSans"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        num: ['"SF Pro Display"', '"Segoe UI Variable"', 'sans-serif'],
      },
    },
  },
  plugins: [animate],
} satisfies Config
