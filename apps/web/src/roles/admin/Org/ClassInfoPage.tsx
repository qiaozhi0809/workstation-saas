import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { ClassAdmin } from '@/shared/types/admin'
import DeskSummary from './DeskSummary'
import { errMsg } from './errMsg'
import Field from './Field'
import StaffEditor from './StaffEditor'

function BasicCard({ cls }: { cls: ClassAdmin }) {
  const qc = useQueryClient()
  const grades = useQuery({ queryKey: ['admin', 'grades'], queryFn: adminApi.grades })
  const [name, setName] = useState(cls.name)
  const [gradeId, setGradeId] = useState(cls.grade_id)
  const [room, setRoom] = useState(cls.room)
  const save = useMutation({
    mutationFn: () => adminApi.updateClass(cls.id, { grade_id: gradeId, name: name.trim(), room: room.trim() }),
    onSuccess: () => {
      toast('班级信息已保存')
      void qc.invalidateQueries({ queryKey: ['admin', 'class', cls.id] })
      void qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'grades'] })
    },
  })
  const list = grades.data ?? []
  const stage = list.find((g) => g.id === gradeId)?.effective_stage
  return (
    <Card>
      <CardHeader><CardTitle>基本信息</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="班级名称"><Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="年级">
            <NativeSelect value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              {list.length === 0 && <option value={cls.grade_id}>{cls.grade_name}</option>}
              {list.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="教室"><Input value={room} maxLength={30} onChange={(e) => setRoom(e.target.value)} /></Field>
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">学段</span>
            <span className="flex h-9 items-center">{stage ?? '—'}</span>
          </div>
        </div>
        {save.isError && <p role="alert" className="text-sm text-destructive">{errMsg(save.error)}</p>}
        <div><Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>保存</Button></div>
      </CardContent>
    </Card>
  )
}

export default function ClassInfoPage() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['admin', 'class', id], queryFn: () => adminApi.class(id) })
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Link to="/admin/org" className="text-sm text-primary underline-offset-4 hover:underline">返回组织架构</Link>
        <h1 className="text-lg font-semibold">{q.data ? `${q.data.grade_name}${q.data.name}` : '班级信息'}</h1>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState title="班级信息加载失败" description={errMsg(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <BasicCard key={`${q.data.id}:${q.data.name}:${q.data.grade_id}:${q.data.room}`} cls={q.data} />
          <StaffEditor cls={q.data} />
          <DeskSummary cls={q.data} />
        </>
      )}
    </div>
  )
}
