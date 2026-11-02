import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const token = (name: string) => `hsl(var(--${name}))`
const pair = (name: string) => ({ DEFAULT: token(name), foreground: token(`${name}-foreground`) })

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
