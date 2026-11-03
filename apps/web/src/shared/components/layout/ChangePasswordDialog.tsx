import { useState, type FormEvent } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { authApi } from '@/shared/api/auth'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useAuthStore } from '@/shared/stores/auth'

/** 改密码表单:强制改密码页与账号菜单的对话框共用。成功后调 onSuccess */
export function ChangePasswordForm({ onSuccess, onCancel }: { onSuccess(): void | Promise<void>; onCancel?(): void }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPw !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setPending(true)
    try {
      const refreshToken = useAuthStore.getState().refreshToken ?? ''
      await authApi.changePassword({ old_password: oldPw, new_password: newPw, refresh_token: refreshToken })
      await onSuccess()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败,请稍后再试')
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pw-old">旧密码</Label>
        <Input id="pw-old" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-new">新密码</Label>
        <Input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" required />
        <p className="text-xs text-muted-foreground">至少 8 位,字母、数字、符号中至少两种</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pw-confirm">确认新密码</Label>
        <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>取消</Button>}
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          保存
        </Button>
      </div>
    </form>
  )
}

export default function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose} title="修改密码" dismissOnOutside={false} className="max-w-sm">
      {/* 打开时才挂载,关闭即清空输入 */}
      {open && (
        <ChangePasswordForm
          onCancel={onClose}
          onSuccess={async () => {
            try { useAuthStore.getState().setUser(await authApi.me()) } catch { /* 刷新失败不影响改密码成功 */ }
            onClose()
          }}
        />
      )}
    </Modal>
  )
}
