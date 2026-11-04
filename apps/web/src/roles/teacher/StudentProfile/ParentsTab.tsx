import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { parentLinksApi } from '@/shared/api/parentLinks'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { ParentOfStudent, ParentRelation } from '@/shared/types/parent'
import type { StudentProfile } from '@/shared/types/student'

const RELATIONS: readonly ParentRelation[] = ['父亲', '母亲', '祖辈', '其他']
const MAX_PARENTS = 4
const SHARED_HINT = '该账号也是教职工账号,请联系信息中心重置'

/** 一次性密码只放在调用方的局部状态里:不进 query 缓存、不进 storage、不打日志。 */
interface Secret { phone: string; password: string; reset: boolean }

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制')
  } catch {
    toast('复制失败,请手动复制')
  }
}

const errMsg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

function SecretDialog({ secret, onClose }: { secret: Secret | null; onClose(): void }) {
  return (
    <Modal open={!!secret} onClose={onClose} title={secret?.reset ? '密码已重置' : '家长账号'} dismissOnOutside={false}>
      {secret && (
        <div className="space-y-3 text-sm">
          <p>
            {secret.reset
              ? `登录名 ${secret.phone},临时密码 ${secret.password}。请当面或电话告诉家长,关闭后无法再次查看。`
              : `家长账号已建好,登录名 ${secret.phone},临时密码 ${secret.password}。请当面或电话告诉家长,关闭后无法再次查看。`}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyText(secret.password)}>复制</Button>
            <Button type="button" size="sm" onClick={onClose}>我已记下</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function AddForm({ studentId, full, onSecret }: { studentId: string; full: boolean; onSecret(s: Secret): void }) {
  const queryClient = useQueryClient()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [relation, setRelation] = useState<ParentRelation>('母亲')
  const add = useMutation({
    // 临时密码只交给对话框,不留在 mutation 状态 / MutationCache 里
    mutationFn: async () => {
      const res = await parentLinksApi.create(studentId, { phone: phone.trim(), name: name.trim(), relation })
      if (res.temp_password) onSecret({ phone: res.parent.phone, password: res.temp_password, reset: false })
      return { existing: !res.temp_password }
    },
    onSuccess: ({ existing }) => {
      if (existing) toast('该手机号已有账号,已绑定到这个孩子,家长用原来的密码登录')
      setPhone('')
      setName('')
      return queryClient.invalidateQueries({ queryKey: ['student-parents', studentId] })
    },
    onError: (err) => toast(errMsg(err, '添加失败,请重试')),
  })

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="手机号" inputMode="numeric" maxLength={11} placeholder="手机号" className="h-8 w-36" value={phone}
          onChange={(e) => setPhone(e.target.value)} />
        <Input aria-label="称呼" maxLength={20} placeholder="称呼" className="h-8 w-28" value={name}
          onChange={(e) => setName(e.target.value)} />
        <NativeSelect aria-label="关系" className="h-8" value={relation} onChange={(e) => setRelation(e.target.value as ParentRelation)}>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </NativeSelect>
        <Button type="button" size="sm" disabled={full || add.isPending || !phone.trim() || !name.trim()} onClick={() => add.mutate()}>添加家长</Button>
      </div>
      {full && <p className="text-xs text-muted-foreground">每个孩子最多 {MAX_PARENTS} 位家长</p>}
    </div>
  )
}

function ParentRow({ p, studentId, onSecret }: { p: ParentOfStudent; studentId: string; onSecret(s: Secret): void }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['student-parents', studentId] })
  const primary = useMutation({
    mutationFn: () => parentLinksApi.setPrimary(p.link_id),
    onSuccess: refresh,
    onError: (err) => toast(errMsg(err, '操作失败,请重试')),
  })
  const unlink = useMutation({
    mutationFn: () => parentLinksApi.unlink(p.link_id),
    onSuccess: refresh,
    onError: (err) => toast(errMsg(err, '解绑失败,请重试')),
  })
  const reset = useMutation({
    mutationFn: async () => {
      const res = await parentLinksApi.resetPassword(p.link_id)
      onSecret({ phone: p.phone, password: res.temp_password, reset: true })
    },
    onError: (err) => toast(errMsg(err, '重置失败,请重试')),
  })
  const busy = primary.isPending || unlink.isPending || reset.isPending

  return (
    <li className="border-b border-border pb-3 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground">{p.name}</span>
        <span className="text-muted-foreground">{p.relation}</span>
        <span className="text-muted-foreground">{p.phone}</span>
        {p.is_primary && <Badge variant="info">主家长</Badge>}
        {p.status === 'readonly' && <Badge variant="neutral">已毕业 / 已离校</Badge>}
        {p.account_status !== 'active' && <Badge variant="warning">已停用</Badge>}
        {p.must_change_password && <Badge variant="neutral">未首次登录</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {!p.is_primary && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busy} onClick={() => primary.mutate()}>设为主家长</Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busy || p.shared_account} onClick={() => reset.mutate()}>重置密码</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={busy}
          onClick={() => { if (window.confirm('解绑后这位家长将看不到该学生')) unlink.mutate() }}>解绑</Button>
      </div>
      {p.shared_account && <p className="mt-1 text-xs text-muted-foreground">{SHARED_HINT}</p>}
    </li>
  )
}

export default function ParentsTab({ profile }: { profile: StudentProfile }) {
  const [secret, setSecret] = useState<Secret | null>(null)
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['student-parents', profile.id],
    queryFn: () => parentLinksApi.list(profile.id),
  })

  return (
    <section>
      <AddForm studentId={profile.id} full={(data?.length ?? 0) >= MAX_PARENTS} onSecret={setSecret} />
      {error ? <ErrorState title="家长加载失败" onRetry={() => void refetch()} retrying={isFetching} />
        : !data ? <LoadingState />
        : data.length === 0 ? <EmptyState icon={Users} title="还没有绑定家长" />
        : (
          <ul className="space-y-3">
            {data.map((p) => <ParentRow key={p.link_id} p={p} studentId={profile.id} onSecret={setSecret} />)}
          </ul>
        )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </section>
  )
}
