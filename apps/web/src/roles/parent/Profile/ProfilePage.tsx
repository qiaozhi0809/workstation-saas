import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { toast } from '@/shared/components/Toast'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { PageHeader } from '@/shared/components/ui/page'
import type { Contact } from '@/shared/types/student'
import ParentPage from '../ParentPage'
import { useChild } from '../useChild'
import ContactsForm from './ContactsForm'

const Item = ({ label, value }: { label: string; value: string | null | undefined }) => {
  const text = value?.trim()
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">
        {text ? text : <span className="text-muted-foreground">暂无</span>}
      </dd>
    </div>
  )
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="p-4 text-sm">
    <h2 className="mb-1 text-sm font-medium">{title}</h2>
    {children}
  </Card>
)

export default function ProfilePage() {
  const { child } = useChild()
  const sid = child?.student_id ?? ''
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  // 切换孩子时退出编辑,免得把 A 的联系人写到 B
  useEffect(() => {
    setEditing(false)
  }, [sid])
  const q = useQuery({
    queryKey: ['parent', sid, 'profile'],
    queryFn: () => parentApi.profile(sid),
    enabled: !!child,
  })
  if (!child) return null
  if (q.isError)
    return (
      <ParentPage>
        <ErrorState title="档案加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </ParentPage>
    )
  if (!q.data)
    return (
      <ParentPage>
        <LoadingState variant="form" />
      </ParentPage>
    )
  const p = q.data
  const contacts: Contact[] = p.contacts ?? []
  const tags = p.tags ?? []

  const save = async (next: Contact[]) => {
    const saved = await parentApi.saveContacts(sid, next)
    qc.setQueryData(['parent', sid, 'profile'], saved)
    toast('已保存')
    setEditing(false)
  }

  return (
    <ParentPage>
      <PageHeader title={`${p.name}的档案`} />
      <Group title="基本信息">
        <dl>
          <Item label="姓名" value={p.name} />
          <Item label="性别" value={p.gender} />
          <Item label="学号" value={p.student_no} />
          <Item label="生日" value={p.birthdate} />
          <Item label="班级职务" value={p.class_role} />
        </dl>
      </Group>
      <Group title="家庭信息">
        <dl>
          <Item label="家庭结构" value={p.family_structure} />
          {p.boarding != null && <Item label="住校" value={p.boarding ? '是' : '否'} />}
          <Item label="家庭备注" value={p.family_note} />
        </dl>
        <h3 className="mb-1 mt-3 text-sm font-medium">联系人</h3>
        {editing ? (
          <ContactsForm
            key={sid}
            initial={contacts}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            {contacts.length === 0 ? (
              <p className="text-muted-foreground">还没有联系人</p>
            ) : (
              <ul className="space-y-2">
                {contacts.map((c, i) => (
                  <li key={i} className="rounded-md bg-muted p-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{c.name}</span>{' '}
                        <span className="text-muted-foreground">{c.relation}</span>
                      </span>
                      <span className="break-all">{c.phone}</span>
                    </div>
                    {c.job && <div className="break-words text-muted-foreground">{c.job}</div>}
                  </li>
                ))}
              </ul>
            )}
            {p.can_edit_contacts && (
              <Button
                variant="outline"
                size="touch"
                className="mt-3"
                onClick={() => setEditing(true)}
              >
                编辑联系人
              </Button>
            )}
          </>
        )}
      </Group>
      <Group title="学习情况">
        <dl>
          <Item label="学习情况" value={p.learning_summary} />
        </dl>
      </Group>
      <Group title="性格特长与健康">
        <dl>
          <Item label="性格特长" value={p.personality} />
          <Item label="健康备注" value={p.health_notes} />
        </dl>
      </Group>
      <Group title="标签">
        {tags.length === 0 ? (
          <p className="text-muted-foreground">暂无</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t} className="rounded-sm bg-secondary px-3 py-1 text-secondary-foreground">
                {t}
              </li>
            ))}
          </ul>
        )}
      </Group>
    </ParentPage>
  )
}
