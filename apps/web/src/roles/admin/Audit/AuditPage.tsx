import { Fragment, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { adminApi, type AuditFilters as AuditQuery } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { IconButton } from '@/shared/components/ui/icon-button'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { todayIn, useSchoolTz } from '@/shared/hooks/useSchoolTz'
import { addDays, formatInTz } from '@/shared/lib/date'
import type { AuditRow } from '@/shared/types/admin'
import AuditFilters, { type AuditFilterValue } from './AuditFilters'
import AuditRowDetail from './AuditRowDetail'

const PAGE_SIZE = 50
/** 最近 7 天:学校时区里的今天往前 6 天到今天(后端按学校时区算日界,L43) */
const defaultRange = (tz: string) => {
  const to = todayIn(tz)
  return { from: addDays(to, -6), to }
}

const HEADS = ['时间', '操作人', '操作', '对象', 'IP', '结果']
/** 对象列:有名字显示名字;只有 id(如发送通知的通知 id)时显示动作中文名而不是 UUID(L58) */
const objectText = (r: AuditRow) => r.object_label ?? (r.object_id ? r.action_label : '—')

/** 默认区间要按学校时区算,所以等拿到时区再初始化筛选状态 */
export default function AuditPage() {
  const school = useSchoolTz()
  if (!school.ready) return <LoadingState variant="table" />
  return <AuditLog tz={school.tz} />
}

function AuditLog({ tz }: { tz: string }) {
  const [filter, setFilter] = useState<AuditFilterValue>(() => ({
    ...defaultRange(tz),
    user: null,
    group: '',
    action: '',
    objectType: '',
    deniedOnly: false,
  }))
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const query: AuditQuery = {
    ...(filter.from && { from: filter.from }),
    ...(filter.to && { to: filter.to }),
    ...(filter.user && { user_id: filter.user.id }),
    ...(filter.group && { group: filter.group }),
    ...(filter.action && { action: filter.action }),
    ...(filter.objectType && { object_type: filter.objectType }),
    ...(filter.deniedOnly && { success: false }),
    page,
  }
  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: adminApi.auditActions,
    staleTime: Infinity,
  })
  const list = useQuery({
    queryKey: ['audit', query],
    queryFn: () => adminApi.audit(query),
    placeholderData: keepPreviousData,
  })

  const change = (patch: Partial<AuditFilterValue>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setPage(1)
    setOpen(new Set())
  }
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const goto = (p: number) => {
    setPage(p)
    setOpen(new Set())
  }

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const hasTable = !list.isError && !!list.data && list.data.items.length > 0
  const pager = total > PAGE_SIZE && (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground">{`共 ${total} 条,第 ${page} / ${pages} 页`}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => goto(page - 1)}
      >
        上一页
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => goto(page + 1)}
      >
        下一页
      </Button>
    </div>
  )

  return (
    <PageContainer width="default">
      <PageHeader title="审计日志" />
      <AuditFilters value={filter} actions={actions.data} onChange={change} />

      {list.isError ? (
        <ErrorState
          title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.data ? (
        <LoadingState variant="table" />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="没有符合条件的记录" />
      ) : (
        <div className="flex w-fit max-w-full flex-col gap-3">
          <Table minWidth={768} containerClassName="w-fit max-w-full">
            <TableHead>
              <TableRow>
                {HEADS.map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.data.items.map((r) => {
                const hasExtra = !!r.extra && Object.keys(r.extra).length > 0
                const expanded = open.has(r.id)
                return (
                  <Fragment key={r.id}>
                    {/* 被拒只在结果列用徽章标出,整行不染色;data-failed 留给测试和筛选脚本 */}
                    <TableRow data-failed={r.success ? 'false' : 'true'}>
                      {/* 时间按学校时区显示,与上面的筛选区间同一口径(L270) */}
                      <Td>{formatInTz(r.at, tz)}</Td>
                      <Td>{r.user_name ?? '—'}</Td>
                      <Td nowrap={false}>
                        <span className="flex items-center gap-1">
                          {hasExtra ? (
                            <IconButton
                              size="sm"
                              icon={expanded ? ChevronDown : ChevronRight}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? '收起' : '展开'} ${r.action_label}`}
                              onClick={() => toggle(r.id)}
                            />
                          ) : (
                            // 与展开按钮同宽的占位:让整列操作文字左缘一致
                            <span aria-hidden="true" className="h-8 w-8 shrink-0" />
                          )}
                          {r.action_label}
                        </span>
                      </Td>
                      <Td nowrap={false}>{objectText(r)}</Td>
                      <Td>{r.ip ?? '—'}</Td>
                      <Td>
                        <Badge variant={r.success ? 'success' : 'danger'}>
                          {r.success ? '成功' : '被拒'}
                        </Badge>
                      </Td>
                    </TableRow>
                    {hasExtra && expanded && (
                      <TableRow className="bg-muted/40">
                        <Td colSpan={HEADS.length} nowrap={false} className="py-2">
                          <AuditRowDetail extra={r.extra as Record<string, unknown>} />
                        </Td>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
          {pager}
        </div>
      )}

      {!hasTable && pager}
    </PageContainer>
  )
}
