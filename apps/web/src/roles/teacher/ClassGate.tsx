import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, School } from 'lucide-react'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassPerm, ClassroomSummary } from '@/shared/types/classroom'

/**
 * ClassGate 交给页面内容的上下文。
 * - cls:顶栏当前选中的班级(['my-classes'] 里 useTeacherStore.classId 对应的一项)
 * - summary:该班概况(['classroom', classId])
 * - perms:我在本班的权限 = summary.my_perms
 * - subjects:我在本班任教的科目 = summary.my_subjects(只当班主任、不任教时为 [])
 */
export interface ClassContext {
  cls: ClassView
  summary: ClassroomSummary
  perms: ClassPerm[]
  subjects: string[]
}

/**
 * 教师端"按班级"页面的统一外壳:负责班级列表 / 概况的加载、出错重试、无班级状态与权限检查。
 * 标题只给读屏用(<h1 sr-only>);缺 need 权限时显示"你在本班没有这项权限"。
 * 换班级时 children 整体重建(key = 班级 id)。
 */
export default function ClassGate({
  title,
  need,
  children,
}: {
  title: string
  need?: ClassPerm
  children(ctx: ClassContext): ReactNode
}) {
  const classId = useTeacherStore((s) => s.classId)
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const items = classes.data?.items ?? []
  const cls = classId ? items.find((c) => c.id === classId) : undefined

  let body: ReactNode
  if (classes.isLoading) body = <LoadingState />
  else if (classes.isError && !classes.data) {
    body = (
      <ErrorState
        title="班级加载失败"
        onRetry={() => void classes.refetch()}
        retrying={classes.isFetching}
      />
    )
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={School}
        title="没有可查看的班级"
        description="请联系学校管理员为你分配班级"
      />
    )
  } else if (!cls) body = <LoadingState />
  else
    body = (
      <GateBody key={cls.id} cls={cls} need={need}>
        {children}
      </GateBody>
    )

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {body}
    </>
  )
}

function GateBody({
  cls,
  need,
  children,
}: {
  cls: ClassView
  need?: ClassPerm
  children(ctx: ClassContext): ReactNode
}) {
  // 与教室页 / TeacherLayout 同一个 key,共用缓存
  const summary = useQuery({
    queryKey: ['classroom', cls.id],
    queryFn: () => classroomApi.summary(cls.id),
  })
  if (summary.isLoading) return <LoadingState />
  if (!summary.data) {
    return (
      <ErrorState
        title="班级概况加载失败"
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
      />
    )
  }
  const perms = summary.data.my_perms
  if (need && !perms.includes(need)) {
    return (
      <EmptyState
        icon={Lock}
        title="你在本班没有这项权限"
        description="如需使用,请联系班主任或学校管理员"
      />
    )
  }
  return <>{children({ cls, summary: summary.data, perms, subjects: summary.data.my_subjects })}</>
}
