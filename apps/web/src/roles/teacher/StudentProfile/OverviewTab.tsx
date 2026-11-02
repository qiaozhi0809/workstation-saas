import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { toast } from '@/shared/components/Toast'
import type { StudentProfile } from '@/shared/types/student'
import Field from './Field'

// eslint-disable-next-line react-refresh/only-export-components
export const CLASS_ROLE_PRESETS = [
  '班长', '副班长', '学习委员', '纪律委员', '体育委员', '文艺委员', '劳动委员', '宣传委员', '心理委员',
  '语文课代表', '数学课代表', '英语课代表', '小组长',
]

function ClassRoleRow({ student }: { student: StudentProfile }) {
  const queryClient = useQueryClient()
  const current = student.class_role ?? ''
  const [value, setValue] = useState(current)
  const [seen, setSeen] = useState(current)
  // 服务端的值变了(保存后重新拉取)就以服务端为准
  if (seen !== current) {
    setSeen(current)
    setValue(current)
  }
  const save = useMutation({
    mutationFn: (next: string) => studentsApi.setClassRole(student.class_id, student.enrollment_id, next || null),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['student', student.id] }),
      queryClient.invalidateQueries({ queryKey: ['class-students', student.class_id] }),
    ]),
    onError: (err) => {
      setValue(current)
      toast(err instanceof ApiError ? err.message : '保存失败,请重试')
    },
  })
  const options = value && !CLASS_ROLE_PRESETS.includes(value) ? [...CLASS_ROLE_PRESETS, value] : CLASS_ROLE_PRESETS

  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-muted-foreground">职务</dt>
      <dd>
        <NativeSelect aria-label="职务" className="h-8" value={value}
          onChange={(e) => { setValue(e.target.value); save.mutate(e.target.value) }}>
          <option value="">无</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      </dd>
    </div>
  )
}

export default function OverviewTab({ student }: { student: StudentProfile }) {
  const summary = useQuery({
    queryKey: ['classroom', student.class_id],
    queryFn: () => classroomApi.summary(student.class_id),
  })
  const canEdit = summary.data?.my_perms.includes('student.write_basic') ?? false
  return (
    <dl>
      <Field label="编号" value={student.mk} />
      <Field label="学号" value={student.student_no} />
      <Field label="性别" value={student.gender} />
      {canEdit ? <ClassRoleRow student={student} /> : <Field label="职务" value={student.class_role} />}
    </dl>
  )
}
