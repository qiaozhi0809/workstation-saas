import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { cn } from '@/shared/lib/utils'
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
      <ErrorState
        title="加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
        className="p-6"
      />
    )
  if (!q.data) return <LoadingState />
  const d = q.data
  const active = gradeId ?? d.grade_id

  // ≥ 1024 时侧栏固定宽度放右侧(看板少一列),更窄时侧栏落到页面下方
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold">全校看板</h1>
          {d.grades.length > 0 && (
            <div className="max-w-full overflow-x-auto">
              <SegmentedTabs
                label="年级"
                items={d.grades.map((g) => ({ value: g.id, label: g.name }))}
                value={active ?? ''}
                onChange={setGradeId}
              />
            </div>
          )}
        </header>
        {d.classes.length === 0 ? (
          <EmptyState title="暂无班级" />
        ) : (
          // 带侧栏时 1024 宽只剩约 640 px 给卡片,保持两列到 xl 才三列(L216)
          <div
            data-class-grid
            className={cn(
              'grid grid-cols-1 gap-4 md:grid-cols-2',
              canWatch ? 'xl:grid-cols-3 2xl:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-4',
            )}
          >
            {d.classes.map((c) => (
              <ClassCard key={c.id} cls={c} />
            ))}
          </div>
        )}
      </div>
      {canWatch && (
        // ≥ 1024 侧栏随滚动固定在 #main(滚动容器)顶部;高度不超过主区域(视口减去 3.5rem 顶栏,
        // 否则底部 56 px 被裁掉),班级列表多时在侧栏内部滚动(L216)
        <div className="w-full lg:sticky lg:top-0 lg:max-h-[calc(100dvh-3.5rem)] lg:w-80 lg:shrink-0 lg:overflow-auto xl:w-96">
          <CameraWallMini gradeId={active} />
        </div>
      )}
    </div>
  )
}
