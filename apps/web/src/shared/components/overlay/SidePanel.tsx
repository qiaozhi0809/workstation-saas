import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { useFullscreenHost } from '@/shared/hooks/useFullscreenHost'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/components/ui/sheet'
import { useRestoreFocus } from './useRestoreFocus'
import type { ModalProps } from './Modal'

export default function SidePanel({
  open, onClose, title, description, dismissOnOutside = true, className, children, side = 'right',
}: ModalProps & { side?: 'left' | 'right' }) {
  const host = useFullscreenHost()
  const restoreFocus = useRestoreFocus(open)
  useEscapeLayer(open, onClose)
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side={side}
        container={host}
        aria-modal="true"
        className={className}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onCloseAutoFocus={restoreFocus}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={dismissOnOutside ? undefined : (e) => e.preventDefault()}
      >
        <div className="flex h-full flex-col gap-4 overflow-y-auto">
          <SheetHeader className="pr-6">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
