import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { classesApi } from '@/shared/api/classes'
import { studentsApi } from '@/shared/api/students'
import ClassroomMap from '@/shared/components/ClassroomMap'
import { useTeacherStore } from '@/shared/stores/teacher'

export default function ClassroomPage() {
  const navigate = useNavigate()
  const classId = useTeacherStore((s) => s.classId)

  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const roster = useQuery({
    queryKey: ['class-students', classId],
    queryFn: () => studentsApi.listInClass(classId as string),
    enabled: !!classId,
  })

  if (classes.isLoading) return <div className="p-6">加载中…</div>
  if (classes.isError) return <div className="p-6">名单加载失败</div>
  const items = classes.data?.items ?? []
  if (items.length === 0) return <div className="p-6">没有可查看的班级</div>
  if (!classId) return <div className="p-6">加载中…</div>
  const cls = items.find((c) => c.id === classId)
  if (!cls) return <div className="p-6">加载中…</div>

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">{cls.name}</h2>
      <p className="mb-4 text-sm text-ink-2">{cls.grade_name}</p>
      {roster.isError ? (
        <div>名单加载失败</div>
      ) : roster.isLoading || !roster.data ? (
        <div>加载中…</div>
      ) : (
        <ClassroomMap
          rows={cls.seat_rows}
          cols={cls.seat_cols}
          seats={roster.data.items}
          mode="daily"
          onSeatClick={(s) => navigate('/teacher/students/' + s.student_id)}
        />
      )}
    </div>
  )
}
