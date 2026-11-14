import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { nextThemeMode, useThemeStore, type ThemeMode } from './theme'

const META: Record<ThemeMode, { label: string; Icon: typeof Sun }> = {
  system: { label: '主题:跟随系统', Icon: Monitor },
  light: { label: '主题:浅色', Icon: Sun },
  dark: { label: '主题:深色', Icon: Moon },
}

/** showLabel:图标旁显示文字(窄屏菜单里用);可访问名称不变 */
export default function ThemeToggle({
  className,
  showLabel = false,
  compact = false,
}: {
  className?: string
  showLabel?: boolean
  /** 只显示图标(侧栏 rail 里用),优先于 showLabel */
  compact?: boolean
}) {
  const mode = useThemeStore((s) => s.mode)
  const setMode = useThemeStore((s) => s.setMode)
  const { label, Icon } = META[mode]
  const withLabel = showLabel && !compact
  return (
    <Button
      variant="ghost"
      size={withLabel ? 'sm' : 'icon'}
      className={cn('min-h-11 min-w-11', className)}
      aria-label={label}
      title={label}
      onClick={() => setMode(nextThemeMode(mode))}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {withLabel && <span>{label}</span>}
    </Button>
  )
}
