import { useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { cn } from '@/shared/lib/utils'
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
  if (!q.data) return <LoadingState />
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
  if (!q.data) return <LoadingState />
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
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = TABS[(i + d + TABS.length) % TABS.length]
    setTab(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">成长</h1>
      <div
        role="tablist"
        aria-label="成长分类"
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            id={`growth-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls="growth-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'min-h-11 rounded-lg px-2 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" tabIndex={0} id="growth-panel" aria-labelledby={`growth-tab-${tab}`}>
        {tab === 'growth' && <GrowthTab sid={sid} />}
        {tab === 'comments' && <CommentsTab sid={sid} />}
        {tab === 'reviews' && <ReviewHistory sid={sid} />}
      </div>
    </div>
  )
}
