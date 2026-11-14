import { useState, type ReactElement } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

/**
 * rail 里图标的右侧提示。disabled(侧栏展开、名字已显示)时只是不显示提示,
 * 子元素始终在同一棵树里:折叠状态一变也不会被卸载重挂,键盘焦点不丢
 */
export function RailTip({
  label,
  children,
  disabled = false,
}: {
  label: string
  children: ReactElement
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={200}>
      <Tooltip.Root open={!disabled && open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={12}
            className="z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-overlay"
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
