import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import AckStatsDialog from '@/shared/components/notices/AckStatsDialog'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import type { NoticeSent } from '@/shared/types/admin'
import NoticeComposer from './NoticeComposer'
import RecipientsDialog from './RecipientsDialog'

const PAGE_SIZE = 20

function SentList({ page, setPage }: { page: number; setPage(p: number): void }) {
  const qc = useQueryClient()
  const [viewing, setViewing] = useState<NoticeSent | null>(null)
  const [recalling, setRecalling] = useState<NoticeSent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = useQuery({
    queryKey: ['notices', 'sent', page],
    queryFn: () => adminApi.sentNotices(page),
    placeholderData: keepPreviousData,
  })
  const tz = localTz()

  const recall = async () => {
    if (!recalling || busy) return
    const { id } = recalling
    setError('')
    setBusy(true)
    try {
      await adminApi.recallNotice(id)
      toast('已撤回')
      setRecalling(null)
      void qc.invalidateQueries({ queryKey: ['notices', 'sent'] })
      void qc.invalidateQueries({ queryKey: ['notices', id, 'recipients'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'today'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '撤回失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <section aria-label="我发出的" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">我发出的</h2>
      {list.isPending ? <LoadingState /> : list.isError ? (
        <ErrorState title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="还没有发出过通知" />
      ) : (
        <ul className="flex flex-col divide-y">
          {list.data.items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <button type="button" aria-haspopup="dialog" onClick={() => setViewing(n)}
                  className="break-words rounded-sm text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  {n.title}
                </button>
                <span className="text-xs text-muted-foreground">{`${n.target_label} · ${formatInTz(n.created_at, tz)}`}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs">
                  {n.audience === 'parents' && <Badge variant="neutral">家长</Badge>}
                  <span>{`已读 ${n.read} / ${n.recipients}`}</span>
                  {n.ack.kind !== 'none' && <span>{`回执 ${n.acked} / ${n.recipients}`}</span>}
                </span>
              </div>
              {n.recalled_at ? (
                <Badge variant="neutral">已撤回</Badge>
              ) : (
                <Button type="button" variant="ghost" size="sm" aria-label={`撤回 ${n.title}`}
                  onClick={() => { setError(''); setRecalling(n) }}>
                  撤回
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{`共 ${total} 条,第 ${page} / ${pages} 页`}</span>
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
      {viewing && (viewing.ack.kind !== 'none'
        ? <AckStatsDialog noticeId={viewing.id} onClose={() => setViewing(null)} />
        : <RecipientsDialog notice={viewing} onClose={() => setViewing(null)} />)}
      {recalling && (
        <Modal open onClose={() => setRecalling(null)} title="撤回通知" description="撤回后收件人将看不到通知内容。">
          <p className="text-sm">{`确认撤回「${recalling.title}」?`}</p>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRecalling(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void recall()}>确认撤回</Button>
          </div>
        </Modal>
      )}
    </section>
  )
}

export default function NoticesPage() {
  // 对象选项(L44):school_wide 决定有没有"全校",年级 / 班级是发送人能发的范围
  const opts = useQuery({ queryKey: ['notices', 'options'], queryFn: adminApi.noticeOptions })
  // "我发出的"的页码提升到这里:发送成功后回到第 1 页(L49)
  const [page, setPage] = useState(1)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold">通知</h1>
      <div className="grid items-start gap-4 md:grid-cols-2">
        {opts.isError && !opts.data ? (
          <ErrorState title="加载失败" onRetry={() => void opts.refetch()} retrying={opts.isFetching} />
        ) : !opts.data ? (
          <LoadingState />
        ) : (
          <NoticeComposer options={opts.data} onSent={() => setPage(1)} />
        )}
        <SentList page={page} setPage={setPage} />
      </div>
    </div>
  )
}
