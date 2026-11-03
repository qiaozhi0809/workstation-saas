import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import type { SchoolInfo } from '@/shared/types/admin'
import { errMsg } from './errMsg'
import Field from './Field'

function SchoolForm({ initial }: { initial: SchoolInfo }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address ?? '')
  const save = useMutation({
    mutationFn: () => adminApi.saveSchool({ name: name.trim(), address: address.trim() || null }),
    onSuccess: () => { toast('学校信息已保存'); void qc.invalidateQueries({ queryKey: ['admin', 'school'] }) },
  })
  return (
    <CardContent className="grid gap-3">
      <Field label="学校名称"><Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="学校地址"><Input value={address} maxLength={100} onChange={(e) => setAddress(e.target.value)} /></Field>
      {save.isError && <p role="alert" className="text-sm text-destructive">{errMsg(save.error)}</p>}
      <div><Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>保存学校信息</Button></div>
    </CardContent>
  )
}

export default function SchoolCard() {
  const q = useQuery({ queryKey: ['admin', 'school'], queryFn: adminApi.school })
  return (
    <Card>
      <CardHeader><CardTitle>学校</CardTitle></CardHeader>
      {q.data ? <SchoolForm initial={q.data} /> : <LoadingState />}
    </Card>
  )
}
