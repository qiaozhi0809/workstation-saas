import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { noticesApi } from '@/shared/api/notices'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { inboxItems, markInboxRead, useInbox } from '@/shared/components/notices/useInbox'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import type { InboxItem } from '@/shared/types/admin'
import ParentNoticeItem from './ParentNoticeItem'

/** 通知页:所有孩子的通知,不随当前孩子过滤;与底部页签徽标共用 ['notices','inbox'],按页加载(L90) */
export default function ParentNoticesPage() {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const inbox = useInbox()
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = inbox
  // 标已读只就地改缓存(这条变已读、页签徽标减一),不重取已加载的各页(L280)
  const read = useMutation({
    mutationFn: (id: string) => noticesApi.read(id),
    onSuccess: (_, id) => markInboxRead(qc, id),
    onError: () => toast('标记已读失败,请重试'),
  })

  const toggle = (it: InboxItem) => {
    setOpenId(openId === it.id ? null : it.id)
    if (openId !== it.id && !it.recalled && !it.read_at) read.mutate(it.id)
  }

  const items = inboxItems(inbox.data)
  let body
  if (inbox.isError && !inbox.data) {
    body = (
      <ErrorState
        title="通知加载失败"
        onRetry={() => void inbox.refetch()}
        retrying={inbox.isFetching}
      />
    )
  } else if (!inbox.data) body = <LoadingState />
  else if (items.length === 0)
    body = <EmptyState title="还没有通知" className="justify-center p-6" />
  else {
    body = (
      <>
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {items.map((it) => (
            <ParentNoticeItem
              key={it.id}
              item={it}
              open={openId === it.id}
              onToggle={() => toggle(it)}
            />
          ))}
        </ul>
        {isFetchNextPageError && (
          <p role="alert" className="text-center text-sm text-destructive">
            加载更多失败
          </p>
        )}
        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? '加载中…' : '加载更多'}
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">通知</h1>
      {body}
    </div>
  )
}
