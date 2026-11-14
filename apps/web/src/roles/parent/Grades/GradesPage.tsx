import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Card } from '@/shared/components/ui/card'
import { PageHeader } from '@/shared/components/ui/page'
import ParentPage from '../ParentPage'
import { useChild } from '../useChild'
import ExamDetail from './ExamDetail'

function ExamList({ sid }: { sid: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['parent', sid, 'exams'], queryFn: () => parentApi.exams(sid) })
  if (q.isError)
    return (
      <ErrorState
        title="考试列表加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  if (!q.data) return <LoadingState variant="cards" />
  if (q.data.length === 0) return <EmptyState title="还没有考试成绩" />
  return (
    <ul className="space-y-2">
      {q.data.map((e) => {
        const open = openId === e.id
        return (
          <li key={e.id}>
            <Card>
              <button
                type="button"
                data-layout-exempt
                aria-expanded={open}
                aria-controls={`exam-panel-${e.id}`}
                onClick={() => setOpenId(open ? null : e.id)}
                className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-base font-medium">{e.name}</span>
                <span className="text-xs text-muted-foreground">
                  {e.date} · {e.year_name} · {e.class_name}
                </span>
              </button>
              {open && (
                <div id={`exam-panel-${e.id}`} className="px-4 pb-4 pt-1">
                  <ExamDetail sid={sid} examId={e.id} />
                </div>
              )}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}

export default function GradesPage() {
  const { child } = useChild()
  if (!child) return null
  return (
    <ParentPage>
      <PageHeader title="成绩" />
      {/* key 随孩子变:切换后重置选中的考试 */}
      <ExamList key={child.student_id} sid={child.student_id} />
    </ParentPage>
  )
}
