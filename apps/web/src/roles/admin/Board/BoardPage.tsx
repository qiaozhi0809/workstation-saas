import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ClassCard from './ClassCard'

export default function BoardPage() {
  const [gradeId, setGradeId] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['admin', 'board', gradeId],
    queryFn: () => adminApi.board(gradeId),
    placeholderData: keepPreviousData,
  })

  if (q.isError) return <ErrorState title="加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} className="p-6" />
  if (!q.data) return <LoadingState />
  const d = q.data
  const active = d.grade_id

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">全校看板</h1>
        {d.grades.length > 0 && (
          <div className="max-w-full overflow-x-auto">
            <SegmentedTabs label="年级" items={d.grades.map((g) => ({ value: g.id, label: g.name }))}
              value={active ?? ''} onChange={setGradeId} />
          </div>
        )}
      </header>
      {d.classes.length === 0 ? (
        <EmptyState title="暂无班级" />
      ) : (
        <div data-class-grid className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {d.classes.map((c) => <ClassCard key={c.id} cls={c} gradeId={active} />)}
        </div>
      )}
    </div>
  )
}
