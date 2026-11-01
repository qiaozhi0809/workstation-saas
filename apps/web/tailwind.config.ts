import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:   { DEFAULT: '#171717', 2: '#5c5c5a', 3: '#9a9a97' },
        line:  { DEFAULT: '#ececea', 2: '#e2e2df' },
        panel: '#ffffff',
        side:  '#fbfbfa',
        fill:  { DEFAULT: '#f3f3f2', 2: '#ebebea' },
        blue:  { DEFAULT: '#2f7ff0', soft: '#e8f1fe' },
        red:   { DEFAULT: '#e5483b', soft: '#fdecea' },
        amber: { DEFAULT: '#e89a0c', soft: '#fdf3df' },
        green: { DEFAULT: '#1d9a57', soft: '#e6f5ec' },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"HarmonyOS Sans SC"', '"MiSans"',
               '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        num:  ['"SF Pro Display"', '"Segoe UI Variable"', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
