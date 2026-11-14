import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { noticesApi } from '@/shared/api/notices'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { inboxItems, markInboxRead, useInbox } from '@/shared/components/notices/useInbox'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { PageHeader } from '@/shared/components/ui/page'
import type { InboxItem } from '@/shared/types/admin'
import ParentPage from '../ParentPage'
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
  } else if (!inbox.data) body = <LoadingState variant="cards" />
  else if (items.length === 0)
    body = <EmptyState title="还没有通知" align="center" className="p-6" />
  else {
    body = (
      <>
        <Card>
          <ul className="flex flex-col divide-y">
            {items.map((it) => (
              <ParentNoticeItem
                key={it.id}
                item={it}
                open={openId === it.id}
                onToggle={() => toggle(it)}
              />
            ))}
          </ul>
        </Card>
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
              size="touch"
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
    <ParentPage>
      <PageHeader title="通知" />
      {body}
    </ParentPage>
  )
}
