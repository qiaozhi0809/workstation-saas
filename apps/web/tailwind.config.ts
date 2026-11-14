import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const token = (name: string) => `hsl(var(--ws-${name}))`
const pair = (name: string) => ({ DEFAULT: token(name), foreground: token(`${name}-foreground`) })

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: pair('primary'),
        secondary: pair('secondary'),
        muted: pair('muted'),
        accent: pair('accent'),
        popover: pair('popover'),
        card: pair('card'),
        chart: {
          1: token('chart-1'),
          2: token('chart-2'),
          3: token('chart-3'),
          4: token('chart-4'),
          5: token('chart-5'),
        },
        destructive: pair('destructive'),
        success: pair('success'),
        warning: pair('warning'),
        info: pair('info'),
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '6px',
        md: '12px',
        lg: '16px',
        xl: '16px',
        '2xl': '16px',
        sidebar: '20px',
      },
      boxShadow: {
        surface: 'var(--ws-shadow-surface)',
        overlay: 'var(--ws-shadow-overlay)',
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"HarmonyOS Sans SC"',
          '"MiSans"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [animate],
} satisfies Config
