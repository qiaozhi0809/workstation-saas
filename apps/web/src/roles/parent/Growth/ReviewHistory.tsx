import { useEffect, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export default function ReviewHistory({ sid }: { sid: string }) {
  const q = useInfiniteQuery({
    queryKey: ['parent', sid, 'reviews'],
    queryFn: ({ pageParam }) => parentApi.reviews(sid, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (q.isError && !q.data) return <ErrorState title="点评加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
  if (!q.data) return <LoadingState />
  const items = q.data.pages.flatMap((p) => p.items)
  if (items.length === 0) return <EmptyState title="还没有点评" />

  return (
    <div>
      <ul className="divide-y rounded-xl border bg-card px-3 text-card-foreground">
        {items.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3">
            <span className={cn('w-10 shrink-0 text-base font-semibold tabular-nums', r.score_delta >= 0 ? 'text-success' : 'text-destructive')}>
              {r.score_delta >= 0 ? `+${r.score_delta}` : `${r.score_delta}`}
            </span>
            <div className="min-w-0 text-sm">
              <p className="break-words">{r.reason_text}</p>
              <p className="text-xs text-muted-foreground">
                {[r.given_at.slice(0, 10), r.subject, r.given_by_name].filter(Boolean).join(' · ')}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {q.isError && <p role="alert" className="mt-2 text-center text-sm text-destructive">加载更多失败</p>}
      {hasNextPage && (
        <div ref={sentinel} className="flex justify-center py-3">
          <Button variant="outline" className="min-h-11" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  )
}
