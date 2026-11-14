import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { useAuthStore } from '@/shared/stores/auth'
import CameraWallMini from './CameraWallMini'
import ClassCard from './ClassCard'

export default function BoardPage() {
  const [gradeId, setGradeId] = useState<string | null>(useSearchParams()[0].get('grade'))
  // 能看监控的(校长 / 教导主任 / 年级组长 / 信息中心)看板旁多一个监控侧栏
  const canWatch = useAuthStore(
    (s) => !!s.user?.admin_perms?.some((p) => p === 'camera.view' || p === 'camera.manage'),
  )
  const q = useQuery({
    queryKey: ['admin', 'board', gradeId],
    queryFn: () => adminApi.board(gradeId),
    placeholderData: keepPreviousData,
  })

  if (q.isError)
    return (
      <PageContainer width="full">
        <PageHeader title="全校看板" />
        <ErrorState title="加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </PageContainer>
    )
  if (!q.data)
    return (
      <PageContainer width="full">
        <PageHeader title="全校看板" />
        <LoadingState variant="cards" />
      </PageContainer>
    )
  const d = q.data
  const active = gradeId ?? d.grade_id

  // 侧栏壳在 1280 宽占掉 264,监控放右侧会把班级卡挤成一列:≥ 1536 才并排,更窄时监控落在班级卡下面
  return (
    <PageContainer width="full">
      <PageHeader
        title="全校看板"
        actions={
          d.grades.length > 0 ? (
            <div className="max-w-full overflow-x-auto">
              <SegmentedTabs
                label="年级"
                size="sm"
                items={d.grades.map((g) => ({ value: g.id, label: g.name }))}
                value={active ?? ''}
                onChange={setGradeId}
              />
            </div>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start">
        <div className="min-w-0 flex-1">
          {d.classes.length === 0 ? (
            <EmptyState title="暂无班级" />
          ) : (
            <div
              data-class-grid
              className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-6"
            >
              {d.classes.map((c) => (
                <ClassCard key={c.id} cls={c} />
              ))}
            </div>
          )}
        </div>
        {canWatch && (
          // ≥ 1536 侧栏随滚动固定在 #main(滚动容器)顶部 24 px 处,高度不超过主区域,
          // 班级列表多时在侧栏内部滚动(L216);更窄时在班级卡下面,按内容高度排
          <div className="w-full 2xl:sticky 2xl:top-6 2xl:max-h-[calc(100dvh-1.5rem)] 2xl:w-96 2xl:shrink-0 2xl:overflow-auto">
            <CameraWallMini gradeId={active} />
          </div>
        )}
      </div>
    </PageContainer>
  )
}
