import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import type { Account, AccountInput } from '@/shared/types/admin'
import type { TempPassword } from './TempPasswordDialog'

const orNull = (s: string) => s.trim() || null
const splitSubjects = (s: string) =>
  s
    .split(/[、/,,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)

/** 新建(account 为空)或编辑。新建成功时把临时密码交给 onCreated,不在本组件留存 */
export default function AccountForm({
  account,
  onClose,
  onCreated,
}: {
  account?: Account
  onClose(): void
  onCreated(t: TempPassword): void
}) {
  const qc = useQueryClient()
  const [loginName, setLoginName] = useState(account?.login_name ?? '')
  const [name, setName] = useState(account?.display_name ?? '')
  const [phone, setPhone] = useState(account?.phone ?? '')
  const [empNo, setEmpNo] = useState(account?.employee_no ?? '')
  const [subjects, setSubjects] = useState((account?.subjects ?? []).join('、'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!account && !loginName.trim()) return setError('请填写登录名')
    if (!name.trim()) return setError('请填写姓名')
    const input: AccountInput = {
      display_name: name.trim(),
      phone: orNull(phone),
      employee_no: orNull(empNo),
      subjects: splitSubjects(subjects),
    }
    setBusy(true)
    setError('')
    try {
      if (account) {
        await adminApi.updateAccount(account.id, input)
        toast(`已保存${input.display_name}`)
        void qc.invalidateQueries({ queryKey: ['admin', 'accounts'] })
        onClose()
      } else {
        // 直接 await,不走 useMutation:临时密码不进 mutation 缓存
        const res = await adminApi.createAccount({ login_name: loginName.trim(), ...input })
        void qc.invalidateQueries({ queryKey: ['admin', 'accounts'] })
        onCreated({
          login_name: res.account.login_name,
          display_name: res.account.display_name,
          temp_password: res.temp_password,
        })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? '编辑账号' : '新建账号'}
      dismissOnOutside={false}
      className="max-w-md"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="acc-login">登录名</Label>
          <Input
            id="acc-login"
            value={loginName}
            disabled={!!account}
            maxLength={32}
            autoComplete="off"
            onChange={(e) => setLoginName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-name">姓名</Label>
          <Input
            id="acc-name"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="acc-phone">手机</Label>
            <Input
              id="acc-phone"
              value={phone}
              maxLength={11}
              inputMode="numeric"
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="acc-emp">工号</Label>
            <Input
              id="acc-emp"
              value={empNo}
              maxLength={20}
              onChange={(e) => setEmpNo(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="acc-subjects">科目</Label>
          <Input
            id="acc-subjects"
            value={subjects}
            placeholder="用顿号或斜杠分隔,如 语文、数学"
            onChange={(e) => setSubjects(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
