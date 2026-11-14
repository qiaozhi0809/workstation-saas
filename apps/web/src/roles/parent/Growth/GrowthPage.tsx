import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { PageHeader } from '@/shared/components/ui/page'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ParentPage from '../ParentPage'
import { useChild } from '../useChild'
import CommentList from './CommentList'
import GrowthTimeline from './GrowthTimeline'
import ReviewHistory from './ReviewHistory'

const TABS = [
  { id: 'growth', label: '成长记录' },
  { id: 'comments', label: '评语' },
  { id: 'reviews', label: '点评' },
] as const
type TabId = (typeof TABS)[number]['id']
// 显式标注,免得 value 被推成 string(SegmentedTabs 的 T 会跟着变成 string)
const TABS_ITEMS: readonly { value: TabId; label: string }[] = TABS.map((t) => ({
  value: t.id,
  label: t.label,
}))

function GrowthTab({ sid }: { sid: string }) {
  const q = useQuery({ queryKey: ['parent', sid, 'growth'], queryFn: () => parentApi.growth(sid) })
  if (q.isError)
    return (
      <ErrorState
        title="成长记录加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  if (!q.data) return <LoadingState variant="cards" />
  if (q.data.items.length === 0) return <EmptyState title="还没有成长记录" />
  return <GrowthTimeline records={q.data.items} />
}

function CommentsTab({ sid }: { sid: string }) {
  const q = useQuery({
    queryKey: ['parent', sid, 'comments'],
    queryFn: () => parentApi.comments(sid),
  })
  if (q.isError)
    return (
      <ErrorState title="评语加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
    )
  if (!q.data) return <LoadingState variant="cards" />
  if (q.data.items.length === 0) return <EmptyState title="还没有评语" />
  return <CommentList comments={q.data.items} />
}

export default function GrowthPage() {
  const { child } = useChild()
  if (!child) return null
  // key 随孩子变:切换后页签回到"成长记录"
  return <GrowthTabs key={child.student_id} sid={child.student_id} />
}

function GrowthTabs({ sid }: { sid: string }) {
  const [tab, setTab] = useState<TabId>('growth')
  const label = TABS.find((t) => t.id === tab)?.label

  return (
    <ParentPage>
      <PageHeader title="成长" />
      <SegmentedTabs
        label="成长分类"
        items={TABS_ITEMS}
        value={tab}
        onChange={setTab}
        className="h-auto w-full [&>button]:min-h-11 [&>button]:flex-1"
      />
      <div role="tabpanel" aria-label={label}>
        {tab === 'growth' && <GrowthTab sid={sid} />}
        {tab === 'comments' && <CommentsTab sid={sid} />}
        {tab === 'reviews' && <ReviewHistory sid={sid} />}
      </div>
    </ParentPage>
  )
}
