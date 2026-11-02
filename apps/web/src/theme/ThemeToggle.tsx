import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { nextThemeMode, useThemeStore, type ThemeMode } from './theme'

const META: Record<ThemeMode, { label: string; Icon: typeof Sun }> = {
  system: { label: '主题:跟随系统', Icon: Monitor },
  light: { label: '主题:浅色', Icon: Sun },
  dark: { label: '主题:深色', Icon: Moon },
}

export default function ThemeToggle({ className }: { className?: string }) {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const { label, Icon } = META[mode]
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={label}
      title={label}
      onClick={() => setMode(nextThemeMode(mode))}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}
