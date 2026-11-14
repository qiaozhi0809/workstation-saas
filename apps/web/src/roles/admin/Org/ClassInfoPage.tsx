import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import type { ClassAdmin } from '@/shared/types/admin'
import DeskSummary from './DeskSummary'
import { errMsg } from './errMsg'
import StaffEditor from './StaffEditor'

const NAME_ORDER = ['name'] as const

function BasicCard({ cls }: { cls: ClassAdmin }) {
  const qc = useQueryClient()
  const grades = useQuery({ queryKey: ['admin', 'grades'], queryFn: adminApi.grades })
  const [name, setName] = useState(cls.name)
  const [gradeId, setGradeId] = useState(cls.grade_id)
  const [room, setRoom] = useState(cls.room)
  const { errors, report, clear, fieldRef } = useFormErrors(NAME_ORDER)
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateClass(cls.id, { grade_id: gradeId, name: name.trim(), room: room.trim() }),
    onSuccess: () => {
      toast('班级信息已保存')
      void qc.invalidateQueries({ queryKey: ['admin', 'class', cls.id] })
      void qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'grades'] })
    },
  })
  const submit = () => {
    if (!report(name.trim() ? {} : { name: '请填写班级名称' })) return
    save.mutate()
  }
  const list = grades.data ?? []
  const stage = list.find((g) => g.id === gradeId)?.effective_stage
  return (
    <Card>
      <CardHeader>
        <CardTitle>基本信息</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="班级名称" error={errors.name}>
            <Input
              ref={fieldRef('name')}
              value={name}
              maxLength={20}
              onChange={(e) => {
                setName(e.target.value)
                clear('name')
              }}
            />
          </Field>
          <Field label="年级">
            <NativeSelect value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              {list.length === 0 && <option value={cls.grade_id}>{cls.grade_name}</option>}
              {list.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="教室">
            <Input value={room} maxLength={30} onChange={(e) => setRoom(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">学段</span>
            <span className="flex h-10 items-center text-sm">{stage ?? '—'}</span>
          </div>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-destructive">
            {errMsg(save.error)}
          </p>
        )}
        <div>
          <Button disabled={save.isPending} onClick={submit}>
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ClassInfoPage() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['admin', 'class', id], queryFn: () => adminApi.class(id) })
  return (
    <PageContainer width="default">
      <Link
        to="/admin/org"
        className="-mb-3 w-fit text-sm text-primary underline-offset-4 hover:underline"
      >
        返回组织架构
      </Link>
      <PageHeader
        title={q.data ? q.data.name : '班级信息'}
        description={q.data ? q.data.grade_name : undefined}
      />
      {q.isPending && <LoadingState variant="form" />}
      {q.isError && (
        <ErrorState
          title="班级信息加载失败"
          description={errMsg(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <>
          <BasicCard
            key={`${q.data.id}:${q.data.name}:${q.data.grade_id}:${q.data.room}`}
            cls={q.data}
          />
          <StaffEditor cls={q.data} />
          <DeskSummary cls={q.data} />
        </>
      )}
    </PageContainer>
  )
}
