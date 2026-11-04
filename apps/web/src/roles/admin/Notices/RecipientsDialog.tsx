import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { formatInTz } from '@/shared/lib/date'
import type { NoticeSent } from '@/shared/types/admin'

/** 一条通知的已读 / 未读名单 */
export default function RecipientsDialog({ notice, onClose }: { notice: NoticeSent; onClose(): void }) {
  const q = useQuery({ queryKey: ['notices', notice.id, 'recipients'], queryFn: () => adminApi.noticeRecipients(notice.id) })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <Modal open onClose={onClose} title={notice.title} className="max-w-md">
      {q.isError ? (
        <ErrorState title={q.error instanceof ApiError ? q.error.message : '加载失败'} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{`已读 ${q.data.read.length} 人`}</h3>
            {q.data.read.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有人读过</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                {q.data.read.map((r) => (
                  <li key={r.user_id} className="flex flex-col py-1">
                    <span>{r.name}</span>
                    <span className="text-xs text-muted-foreground">{formatInTz(r.read_at, tz)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{`未读 ${q.data.unread.length} 人`}</h3>
            {q.data.unread.length === 0 ? (
              <p className="text-sm text-muted-foreground">全部已读</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto text-sm">
                {q.data.unread.map((u) => <li key={u.user_id} className="py-1">{u.name}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
