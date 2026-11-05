import type { ReactNode } from 'react'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'

export default function ConfirmBox({
  open,
  title,
  children,
  confirmLabel,
  error,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  error?: string | null
  busy?: boolean
  onConfirm(): void
  onClose(): void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md">
      <div className="grid gap-3 text-sm">
        {children}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
