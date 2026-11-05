import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { noticesApi } from '@/shared/api/notices'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import type { AckRow, AckStats } from '@/shared/types/admin'

type Tab = 'acked' | 'unacked' | 'unread'
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'acked', label: '已回执' },
  { value: 'unacked', label: '未回执' },
  { value: 'unread', label: '未读' },
]
const PICK: Record<Tab, (r: AckRow) => boolean> = {
  acked: (r) => r.acked_at !== null,
  unacked: (r) => r.acked_at === null,
  unread: (r) => r.read_at === null,
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function ackText(data: AckStats, r: AckRow): string {
  const label =
    data.ack.kind === 'choice' && r.choice !== null ? (data.ack.options[r.choice] ?? '') : '已知晓'
  return r.note ? `${label}(${r.note})` : label
}

/** 发送人看的回执统计:计数、选项条形、三个名单、导出 CSV */
export default function AckStatsDialog({
  noticeId,
  open = true,
  onClose,
}: {
  noticeId: string
  open?: boolean
  onClose?(): void
}) {
  const [tab, setTab] = useState<Tab>('acked')
  const q = useQuery({
    queryKey: ['notices', noticeId, 'acks'],
    queryFn: () => noticesApi.acks(noticeId),
    enabled: open,
    staleTime: 0, // 回执随时在变:关掉再打开必须重新取,不能先显示 30 秒前的缓存
  })
  const exp = useMutation({
    mutationFn: () => noticesApi.exportAcks(noticeId),
    onSuccess: (blob) => saveBlob(`回执名单-${noticeId}.csv`, blob),
  })
  const data = q.data

  return (
    <Modal open={open} onClose={() => onClose?.()} title="回执统计" className="max-w-2xl">
      {q.isPending && <LoadingState />}
      {q.isError && (
        <ErrorState
          title="回执统计加载失败"
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      )}
      {data && <Body data={data} tab={tab} setTab={setTab} />}
      {data && (
        <div className="flex items-center justify-end gap-3">
          {exp.isError && (
            <span role="alert" className="text-sm text-destructive">
              {exp.error instanceof ApiError ? exp.error.message : '导出失败,请重试'}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exp.isPending}
            onClick={() => exp.mutate()}
          >
            导出 CSV
          </Button>
        </div>
      )}
    </Modal>
  )
}

function Body({ data, tab, setTab }: { data: AckStats; tab: Tab; setTab(t: Tab): void }) {
  const parents = data.audience === 'parents'
  const rows = data.rows.filter(PICK[tab])
  const withAck = tab === 'acked'
  const max = Math.max(1, data.total)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">
        已读 {data.read} / {data.total} · 已回执 {data.acked} / {data.total}
      </p>

      {data.ack.kind === 'choice' && (
        <ul aria-label="选项统计" className="flex flex-col gap-2">
          {data.ack.options.map((opt, i) => {
            const n = data.counts[i] ?? 0
            return (
              <li key={i} className="flex flex-col gap-1 text-sm">
                <span className="flex justify-between">
                  <span>{opt}</span>
                  <span>{n} 人</span>
                </span>
                <span aria-hidden="true" className="h-2 rounded bg-muted">
                  <span
                    className="block h-2 rounded bg-primary"
                    style={{ width: `${(n / max) * 100}%` }}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {data.students_without_parent > 0 && (
        <p className="text-sm text-muted-foreground">
          另有 {data.students_without_parent} 名学生还没有绑定家长
        </p>
      )}

      <SegmentedTabs label="名单" items={TABS} value={tab} onChange={setTab} />

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">暂无</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                {parents ? (
                  <>
                    <th className="py-1 pr-3 font-medium">班级</th>
                    <th className="py-1 pr-3 font-medium">学生</th>
                    <th className="py-1 pr-3 font-medium">家长</th>
                  </>
                ) : (
                  <th className="py-1 pr-3 font-medium">姓名</th>
                )}
                {withAck && <th className="py-1 font-medium">回执</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.user_id}:${r.student_id ?? ''}`} className="border-b last:border-0">
                  {parents ? (
                    <>
                      <td className="py-1 pr-3">{r.class_name}</td>
                      <td className="py-1 pr-3">{r.student_name}</td>
                      <td className="py-1 pr-3">{r.user_name}</td>
                    </>
                  ) : (
                    <td className="py-1 pr-3">{r.user_name}</td>
                  )}
                  {withAck && <td className="py-1">{ackText(data, r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
