import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import {
  Table,
  TableBody,
  TableFoot,
  TableHead,
  TableRow,
  Td,
  Th,
} from '@/shared/components/ui/table'
import { monthIn, useSchoolTz } from '@/shared/hooks/useSchoolTz'

const pad = (n: number) => String(n).padStart(2, '0')
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return `${y}年${mo}月`
}

/** 默认月份要按学校时区算(后端按学校时区算日界,L43),所以等拿到时区再初始化状态 */
export default function AiUsagePage() {
  const school = useSchoolTz()
  if (!school.ready) return <LoadingState variant="table" />
  return <AiUsage tz={school.tz} />
}

function AiUsage({ tz }: { tz: string }) {
  const [month, setMonth] = useState(() => monthIn(tz))
  const q = useQuery({
    queryKey: ['ai-usage', month],
    queryFn: () => adminApi.aiUsage(month),
    placeholderData: keepPreviousData,
  })
  const isCurrent = month >= monthIn(tz)

  return (
    <PageContainer width="default">
      <PageHeader
        title="AI 使用"
        description="按月统计各位老师使用 AI 助手的情况"
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="上一月"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="min-w-24 text-center text-sm font-medium" aria-live="polite">
              {monthLabel(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一月"
              disabled={isCurrent}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        }
      />

      {q.isError ? (
        <ErrorState
          title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      ) : !q.data ? (
        <LoadingState variant="table" />
      ) : q.data.rows.length === 0 ? (
        <EmptyState title="这个月还没有人使用 AI 助手" />
      ) : (
        <Table minWidth={640} containerClassName="w-fit max-w-full">
          <TableHead>
            <TableRow>
              <Th>老师</Th>
              <Th numeric>调用次数</Th>
              <Th numeric>失败</Th>
              <Th numeric>输入 token</Th>
              <Th numeric>输出 token</Th>
              <Th>常用场景</Th>
            </TableRow>
          </TableHead>
          <TableBody>
            {q.data.rows.map((r) => (
              <TableRow key={r.user_id}>
                <Td className="font-medium">{r.display_name}</Td>
                <Td numeric>{r.calls}</Td>
                <Td numeric>{r.failed}</Td>
                <Td numeric>{r.prompt_tokens}</Td>
                <Td numeric>{r.completion_tokens}</Td>
                <Td nowrap={false}>
                  {r.top_templates.length === 0
                    ? '—'
                    : r.top_templates.map((t) => `${t.label} × ${t.count}`).join('、')}
                </Td>
              </TableRow>
            ))}
          </TableBody>
          <TableFoot>
            <TableRow className="bg-muted/50">
              <Td>合计</Td>
              <Td numeric>{q.data.total.calls}</Td>
              <Td numeric>{q.data.total.failed}</Td>
              <Td numeric>{q.data.total.prompt_tokens}</Td>
              <Td numeric>{q.data.total.completion_tokens}</Td>
              <Td />
            </TableRow>
          </TableFoot>
        </Table>
      )}
    </PageContainer>
  )
}
