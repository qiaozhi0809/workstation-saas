import type { ReactNode } from 'react'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { useFullscreenHost } from '@/shared/hooks/useFullscreenHost'
import { cn } from '@/shared/lib/utils'
import { useRestoreFocus } from './useRestoreFocus'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export interface ModalProps {
  open: boolean
  onClose(): void
  title: ReactNode
  description?: ReactNode
  /** 点遮罩 / 外部是否关闭;有未保存输入的对话框传 false。默认 true */
  dismissOnOutside?: boolean
  /** 加在内容容器上(宽度等) */
  className?: string
  children: ReactNode
}

export default function Modal({
  open,
  onClose,
  title,
  description,
  dismissOnOutside = true,
  className,
  children,
}: ModalProps) {
  const host = useFullscreenHost()
  const restoreFocus = useRestoreFocus(open)
  useEscapeLayer(open, onClose)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent
        container={host}
        aria-modal="true"
        className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto', className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onCloseAutoFocus={restoreFocus}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={dismissOnOutside ? undefined : (e) => e.preventDefault()}
      >
        <DialogHeader className="touch-dialog-header pr-6">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
