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
import { addDays } from '@/shared/lib/date'
import { cn } from '@/shared/lib/utils'
import { todayIn, useSchoolTz } from '../Reports/useSchoolTz'
import AuditFilters, { type AuditFilterValue } from './AuditFilters'
import AuditRowDetail from './AuditRowDetail'

const PAGE_SIZE = 50
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
/** 最近 7 天:学校时区里的今天往前 6 天到今天(后端按学校时区算日界,L43) */
const defaultRange = (tz: string) => {
  const to = todayIn(tz)
  return { from: addDays(to, -6), to }
}

const HEADS = ['时间', '操作人', '操作', '对象', 'IP', '结果']

/** 默认区间要按学校时区算,所以等拿到时区再初始化筛选状态 */
export default function AuditPage() {
  const school = useSchoolTz()
  if (!school.ready) return <LoadingState />
  return <AuditLog tz={school.tz} />
}

function AuditLog({ tz }: { tz: string }) {
  const [filter, setFilter] = useState<AuditFilterValue>(() => ({
    ...defaultRange(tz),
    user: null,
    group: '',
    deniedOnly: false,
  }))
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const query: AuditQuery = {
    ...(filter.from && { from: filter.from }),
    ...(filter.to && { to: filter.to }),
    ...(filter.user && { user_id: filter.user.id }),
    ...(filter.group && { group: filter.group }),
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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">审计日志</h1>
      <AuditFilters value={filter} actions={actions.data} onChange={change} />

      {list.isError ? (
        <ErrorState
          title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.data ? (
        <LoadingState />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="没有符合条件的记录" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                {HEADS.map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => {
                const hasExtra = !!r.extra && Object.keys(r.extra).length > 0
                const expanded = open.has(r.id)
                return (
                  <Fragment key={r.id}>
                    <tr
                      data-failed={r.success ? 'false' : 'true'}
                      className={cn(
                        'border-t align-middle',
                        !r.success && 'bg-destructive/5 text-destructive',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2">{fmtTime(r.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.user_name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1">
                          {hasExtra && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? '收起' : '展开'} ${r.action_label}`}
                              onClick={() => toggle(r.id)}
                            >
                              {expanded ? (
                                <ChevronDown aria-hidden="true" />
                              ) : (
                                <ChevronRight aria-hidden="true" />
                              )}
                            </Button>
                          )}
                          {r.action_label}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.object_label ?? r.object_id ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.ip ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge variant={r.success ? 'success' : 'danger'}>
                          {r.success ? '成功' : '被拒'}
                        </Badge>
                      </td>
                    </tr>
                    {hasExtra && expanded && (
                      <tr className="bg-muted/40">
                        <td colSpan={HEADS.length} className="px-3 py-2">
                          <AuditRowDetail extra={r.extra as Record<string, unknown>} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
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
      )}
    </div>
  )
}
