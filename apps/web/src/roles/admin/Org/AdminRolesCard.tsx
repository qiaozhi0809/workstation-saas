import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { Account, AdminRole, AdminRoleInput, AdminRoleType } from '@/shared/types/admin'
import ConfirmBox from './ConfirmBox'
import { errMsg } from './errMsg'
import Field from './Field'
import PersonPicker from './PersonPicker'

const ROLES: { role: AdminRoleType; title: string }[] = [
  { role: 'principal', title: '校长 / 副校长' },
  { role: 'dean', title: '教导主任' },
  { role: 'grade_head', title: '年级组长' },
  { role: 'it_admin', title: '信息中心' },
]

export default function AdminRolesCard() {
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const grades = useQuery({ queryKey: ['admin', 'grades'], queryFn: adminApi.grades })
  const [adding, setAdding] = useState<AdminRoleType | null>(null)
  const [picked, setPicked] = useState<Account | null>(null)
  const [gradeId, setGradeId] = useState('')
  const [ending, setEnding] = useState<AdminRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = () => { setAdding(null); setPicked(null); setGradeId(''); setEnding(null); setError(null) }
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'roles'] })
  const add = useMutation({
    mutationFn: (b: AdminRoleInput) => adminApi.addRole(b),
    onSuccess: () => { toast('已添加'); refresh(); close() },
    onError: (e) => setError(errMsg(e)),
  })
  const end = useMutation({
    mutationFn: (id: string) => adminApi.endRole(id),
    onSuccess: () => { toast('已卸任'); refresh(); close() },
    onError: (e) => setError(errMsg(e)),
  })

  const gradeList = grades.data ?? []
  const effectiveGrade = gradeId || gradeList[0]?.id || ''
  const ready = !!picked && (adding !== 'grade_head' || effectiveGrade !== '')
  const title = ROLES.find((r) => r.role === adding)?.title ?? ''

  return (
    <Card>
      <CardHeader><CardTitle>管理岗位</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {roles.isPending && <LoadingState />}
        {roles.data && ROLES.map(({ role, title: t }) => (
          <section key={role} className="grid gap-2 border-b pb-3 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t}</h3>
              <Button variant="outline" size="sm" aria-label={`添加${t}`} onClick={() => { setError(null); setAdding(role) }}>添加</Button>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {roles.data.filter((r) => r.role === role).map((r) => (
                <li key={r.binding_id} className="flex items-center gap-1 text-sm">
                  <span>{r.grade_name ? `${r.display_name}(${r.grade_name})` : r.display_name}</span>
                  <Button variant="ghost" size="sm" aria-label={`卸任 ${r.display_name}`} onClick={() => { setError(null); setEnding(r) }}>卸任</Button>
                </li>
              ))}
              {roles.data.every((r) => r.role !== role) && <li className="text-sm text-muted-foreground">暂无</li>}
            </ul>
          </section>
        ))}
      </CardContent>

      <Modal open={adding !== null} onClose={close} title={`添加${title}`} className="max-w-md">
        <div className="grid gap-3">
          <PersonPicker value={picked} onChange={setPicked} />
          {adding === 'grade_head' && (
            <Field label="负责年级">
              <NativeSelect value={effectiveGrade} onChange={(e) => setGradeId(e.target.value)}>
                {gradeList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>取消</Button>
            <Button disabled={!ready || add.isPending}
              onClick={() => adding && picked && add.mutate({ user_id: picked.id, role: adding, grade_id: adding === 'grade_head' ? effectiveGrade : null })}>
              添加
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmBox open={ending !== null} title="确认卸任" confirmLabel="确认卸任" error={error} busy={end.isPending}
        onConfirm={() => ending && end.mutate(ending.binding_id)} onClose={close}>
        <p>{ending ? `${ending.display_name} 将卸任${ROLES.find((r) => r.role === ending.role)?.title ?? ''}。` : ''}</p>
      </ConfirmBox>
    </Card>
  )
}
