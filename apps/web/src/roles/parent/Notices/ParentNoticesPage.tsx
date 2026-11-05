import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { noticesApi } from '@/shared/api/notices'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import type { InboxItem } from '@/shared/types/admin'
import ParentNoticeItem from './ParentNoticeItem'

/** 通知页:所有孩子的通知,不随当前孩子过滤;与顶栏铃铛共用 ['notices','inbox'] */
export default function ParentNoticesPage() {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const inbox = useQuery({ queryKey: ['notices', 'inbox'], queryFn: () => noticesApi.inbox(1) })
  const read = useMutation({
    mutationFn: (id: string) => noticesApi.read(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notices', 'inbox'] })
    },
    onError: () => toast('标记已读失败,请重试'),
  })

  const toggle = (it: InboxItem) => {
    setOpenId(openId === it.id ? null : it.id)
    if (openId !== it.id && !it.recalled && !it.read_at) read.mutate(it.id)
  }

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
  else if (inbox.data.items.length === 0)
    body = <EmptyState title="还没有通知" className="justify-center p-6" />
  else {
    body = (
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {inbox.data.items.map((it) => (
          <ParentNoticeItem
            key={it.id}
            item={it}
            open={openId === it.id}
            onToggle={() => toggle(it)}
          />
        ))}
      </ul>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">通知</h1>
      {body}
    </div>
  )
}
