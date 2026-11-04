import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { useAuthStore } from '@/shared/stores/auth'
import type { Account } from '@/shared/types/admin'
import AccountForm from './AccountForm'
import AccountRow from './AccountRow'
import ImportAccountsDialog from './ImportAccountsDialog'
import TempPasswordDialog, { type TempPassword } from './TempPasswordDialog'

const PAGE_SIZE = 50
const ROLE_OPTIONS = [
  ['', '全部'], ['homeroom_teacher', '班主任'], ['assistant_teacher', '副班主任'], ['subject_teacher', '任课老师'],
  ['principal', '校长'], ['dean', '教导主任'], ['grade_head', '年级组长'], ['it_admin', '信息中心'],
]
const STATUS_OPTIONS = [['', '全部'], ['active', '在用'], ['frozen', '已冻结']]

type Dialog = { kind: 'form'; account?: Account } | { kind: 'import' } | null

export default function AccountsPage() {
  const qc = useQueryClient()
  const selfId = useAuthStore((s) => s.user?.id)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [freezing, setFreezing] = useState<Account | null>(null)
  const [freezeError, setFreezeError] = useState('')
  const [freezeBusy, setFreezeBusy] = useState(false)
  // 临时密码只放这里,关闭即置空
  const [temp, setTemp] = useState<{ entries: TempPassword[]; batch: boolean } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const filters = { q: q || undefined, role: role || undefined, status: status || undefined, page }
  const list = useQuery({
    queryKey: ['admin', 'accounts', filters],
    queryFn: () => adminApi.accounts(filters),
    placeholderData: keepPreviousData,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'accounts'] })

  const resetPassword = async (a: Account) => {
    try {
      const res = await adminApi.resetPassword(a.id)
      setTemp({ entries: [{ login_name: a.login_name, display_name: a.display_name, temp_password: res.temp_password }], batch: false })
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '重置失败,请重试')
    }
  }
  const unfreeze = async (a: Account) => {
    try {
      await adminApi.unfreeze(a.id)
      toast(`已解冻${a.display_name}`)
      refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '解冻失败,请重试')
    }
  }
  const freeze = async () => {
    if (!freezing || freezeBusy) return
    setFreezeError('')
    setFreezeBusy(true)
    try {
      await adminApi.freeze(freezing.id)
      toast(`已冻结${freezing.display_name}`)
      setFreezing(null)
      refresh()
    } catch (err) {
      setFreezeError(err instanceof ApiError ? err.message : '冻结失败,请重试')
    } finally {
      setFreezeBusy(false)
    }
  }

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const change = (fn: () => void) => { fn(); setPage(1) }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">账号</h1>
        <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'import' })}>批量导入</Button>
        <Button type="button" onClick={() => setDialog({ kind: 'form' })}>新建账号</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="搜索姓名或登录名" placeholder="搜索姓名或登录名" className="w-56" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm">
          身份
          <NativeSelect aria-label="身份" value={role} onChange={(e) => change(() => setRole(e.target.value))}>
            {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          状态
          <NativeSelect aria-label="状态" value={status} onChange={(e) => change(() => setStatus(e.target.value))}>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
        </label>
      </div>

      {list.isPending ? <LoadingState /> : list.isError ? (
        <ErrorState title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="没有符合条件的账号" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                {['姓名', '登录名', '身份', '工号', '最后登录', '状态', '操作'].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <AccountRow key={a.id} account={a} isSelf={a.id === selfId}
                  onEdit={() => setDialog({ kind: 'form', account: a })}
                  onReset={() => void resetPassword(a)}
                  onFreeze={() => { setFreezeError(''); setFreezing(a) }}
                  onUnfreeze={() => void unfreeze(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{`共 ${total} 个账号,第 ${page} / ${pages} 页`}</span>
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}

      {dialog?.kind === 'form' && (
        <AccountForm account={dialog.account} onClose={() => setDialog(null)}
          onCreated={(t) => { setDialog(null); setTemp({ entries: [t], batch: false }) }} />
      )}
      {dialog?.kind === 'import' && (
        <ImportAccountsDialog onClose={() => setDialog(null)}
          onImported={(created) => { setDialog(null); setTemp({ entries: created, batch: true }) }} />
      )}
      {freezing && (
        <Modal open onClose={() => setFreezing(null)} title="冻结账号">
          <p className="text-sm">{`冻结后 ${freezing.display_name} 会立即退出登录,不能再登录;历史记录保留。`}</p>
          {freezeError && <p role="alert" className="mt-2 text-sm text-destructive">{freezeError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFreezing(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={freezeBusy} onClick={() => void freeze()}>确认冻结</Button>
          </div>
        </Modal>
      )}
      {temp && <TempPasswordDialog entries={temp.entries} batch={temp.batch} onClose={() => setTemp(null)} />}
    </div>
  )
}
