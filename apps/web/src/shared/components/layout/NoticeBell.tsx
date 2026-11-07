import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { noticesApi } from '@/shared/api/notices'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import {
  INBOX_KEY,
  inboxItems,
  inboxUnread,
  markInboxAllRead,
  markInboxRead,
  refetchInboxFirstPage,
  useInbox,
} from '@/shared/components/notices/useInbox'
import Popover from '@/shared/components/overlay/Popover'
import { toast } from '@/shared/components/Toast'
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent'
import NoticeList from './NoticeList'

/** 顶栏铃铛:未读数徽标(全量)+ 收件箱按页加载(L90);必须在 RealtimeProvider 与 router 之内 */
export default function NoticeBell() {
  const qc = useQueryClient()
  const inbox = useInbox()
  const refresh = () => void qc.invalidateQueries({ queryKey: INBOX_KEY })

  // 新通知只重取第 1 页;撤回 / 重连仍整体重取(已加载的任一页都可能变)(L280)
  useRealtimeEvent('notice.new', (e) => {
    toast(`新通知:${e.title}`)
    void refetchInboxFirstPage(qc)
  })
  useRealtimeEvent('notice.recalled', refresh)
  useRealtimeEvent('reconnected', refresh)

  // 标已读只就地改缓存(徽标立刻减一),不重取已加载的各页(L280)
  const read = useMutation({
    mutationFn: (id: string) => noticesApi.read(id),
    onSuccess: (_, id) => markInboxRead(qc, id),
    onError: () => toast('标记已读失败,请重试'),
  })
  const readAll = useMutation({
    mutationFn: () => noticesApi.readAll(),
    onSuccess: () => markInboxAllRead(qc),
    onError: () => toast('操作失败,请重试'),
  })

  const unread = inboxUnread(inbox.data)
  return (
    <Popover
      label="通知"
      align="end"
      className="p-0"
      triggerProps={{
        variant: 'ghost',
        size: 'icon',
        className: 'relative',
        'aria-label': `通知,${unread} 条未读`,
        title: '通知',
      }}
      trigger={
        <>
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </>
      }
    >
      {inbox.isError && !inbox.data ? (
        <ErrorState
          title="通知加载失败"
          onRetry={() => void inbox.refetch()}
          retrying={inbox.isFetching}
          className="w-80 max-w-full"
        />
      ) : !inbox.data ? (
        <LoadingState />
      ) : (
        <NoticeList
          items={inboxItems(inbox.data)}
          unread={unread}
          onRead={(id) => read.mutate(id)}
          onReadAll={() => readAll.mutate()}
          readAllBusy={readAll.isPending}
          hasMore={inbox.hasNextPage}
          loadingMore={inbox.isFetchingNextPage}
          loadMoreFailed={inbox.isFetchNextPageError}
          onLoadMore={() => void inbox.fetchNextPage()}
        />
      )}
    </Popover>
  )
}
