import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { noticesApi } from '@/shared/api/notices'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Popover from '@/shared/components/overlay/Popover'
import { toast } from '@/shared/components/Toast'
import { useRealtimeEvent } from '@/shared/realtime/useRealtimeEvent'
import type { Inbox } from '@/shared/types/admin'
import NoticeList from './NoticeList'

const INBOX_KEY = ['notices', 'inbox'] as const

/** 顶栏铃铛:未读数徽标 + 最近 20 条收件箱;必须在 RealtimeProvider 与 router 之内 */
export default function NoticeBell() {
  const qc = useQueryClient()
  const inbox = useQuery({ queryKey: INBOX_KEY, queryFn: () => noticesApi.inbox(1) })
  const refresh = () => void qc.invalidateQueries({ queryKey: INBOX_KEY })

  useRealtimeEvent('notice.new', (e) => {
    toast(`新通知:${e.title}`)
    refresh()
  })
  useRealtimeEvent('notice.recalled', refresh)
  useRealtimeEvent('reconnected', refresh)

  const read = useMutation({
    mutationFn: (id: string) => noticesApi.read(id),
    onSuccess: (_, id) => {
      qc.setQueryData<Inbox>(INBOX_KEY, (old) => old && {
        ...old,
        unread: Math.max(0, old.unread - (old.items.some((i) => i.id === id && !i.read_at && !i.recalled) ? 1 : 0)),
        items: old.items.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i)),
      })
      refresh()
    },
    onError: () => toast('标记已读失败,请重试'),
  })
  const readAll = useMutation({
    mutationFn: () => noticesApi.readAll(),
    onSuccess: refresh,
    onError: () => toast('操作失败,请重试'),
  })

  const unread = inbox.data?.unread ?? 0
  return (
    <Popover
      label="通知"
      align="end"
      className="p-0"
      triggerProps={{ variant: 'ghost', size: 'icon', className: 'relative', 'aria-label': `通知,${unread} 条未读`, title: '通知' }}
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
        <ErrorState title="通知加载失败" onRetry={() => void inbox.refetch()} retrying={inbox.isFetching} className="w-80 max-w-full" />
      ) : !inbox.data ? (
        <LoadingState />
      ) : (
        <NoticeList
          items={inbox.data.items}
          unread={inbox.data.unread}
          onRead={(id) => read.mutate(id)}
          onReadAll={() => readAll.mutate()}
          readAllBusy={readAll.isPending}
        />
      )}
    </Popover>
  )
}
