import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'

const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${y}年${mo}月` }

const HEADS = ['老师', '调用次数', '失败', '输入 token', '输出 token', '常用场景']
const NUM = 'whitespace-nowrap px-3 py-2 text-right tabular-nums'

export default function AiUsagePage() {
  const [month, setMonth] = useState(thisMonth)
  const q = useQuery({
    queryKey: ['ai-usage', month],
    queryFn: () => adminApi.aiUsage(month),
    placeholderData: keepPreviousData,
  })
  const isCurrent = month >= thisMonth()

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">AI 使用</h1>
        <p className="text-sm text-muted-foreground">按月统计各位老师使用 AI 助手的情况</p>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="上一月" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-24 text-center text-sm font-medium" aria-live="polite">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" aria-label="下一月" disabled={isCurrent}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      {q.isError ? (
        <ErrorState title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
          onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <LoadingState />
      ) : q.data.rows.length === 0 ? (
        <EmptyState title="这个月还没有人使用 AI 助手" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                {HEADS.map((h, i) => (
                  <th key={h} scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-medium ${i >= 1 && i <= 4 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.user_id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{r.display_name}</td>
                  <td className={NUM}>{r.calls}</td>
                  <td className={NUM}>{r.failed}</td>
                  <td className={NUM}>{r.prompt_tokens}</td>
                  <td className={NUM}>{r.completion_tokens}</td>
                  <td className="px-3 py-2">
                    {r.top_templates.length === 0 ? '—' : r.top_templates.map((t) => `${t.label} × ${t.count}`).join('、')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/50 font-medium">
                <td className="whitespace-nowrap px-3 py-2">合计</td>
                <td className={NUM}>{q.data.total.calls}</td>
                <td className={NUM}>{q.data.total.failed}</td>
                <td className={NUM}>{q.data.total.prompt_tokens}</td>
                <td className={NUM}>{q.data.total.completion_tokens}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
