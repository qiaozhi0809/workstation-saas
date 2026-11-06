import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminApi, type LoginLogFilters } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { addDays, formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import type { LoginResult, LoginSuspicion } from '@/shared/types/admin'
import { browserSummary } from './browserSummary'

const PAGE_SIZE = 50
const MAX_PAGE = 1000

const RESULTS: [LoginResult, string][] = [
  ['success', '成功'],
  ['bad_password', '密码错误'],
  ['unknown_user', '账号不存在'],
  ['inactive', '账号已停用'],
  ['locked', '已锁定'],
  ['totp_failed', '验证码错误'],
]
const RESULT_LABEL = Object.fromEntries(RESULTS) as Record<LoginResult, string>
const SUSPICION_LABEL: Record<LoginSuspicion, string> = {
  night: '凌晨登录',
  new_network: '新网络',
}
const HEADS = ['时间', '登录名', '账号', '结果', 'IP', '浏览器', '可疑原因']

/** 最近 7 天:学校时区的今天往前 6 天到今天 */
function defaultRange() {
  const to = formatInTz(new Date().toISOString(), localTz()).slice(0, 10)
  return { from: addDays(to, -6), to }
}

export default function LoginLogsPage() {
  const [range, setRange] = useState(defaultRange)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LoginResult[]>([])
  const [suspicious, setSuspicious] = useState(false)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const base: LoginLogFilters = {
    ...(range.from && { from: range.from }),
    ...(range.to && { to: range.to }),
    ...(q && { q }),
    ...(results.length > 0 && { result: results }),
    ...(suspicious && { suspicious: true }),
  }
  const filters: LoginLogFilters = { ...base, page }
  const list = useQuery({
    queryKey: ['admin', 'login-logs', filters],
    queryFn: () => adminApi.loginLogs(filters),
    placeholderData: keepPreviousData,
  })

  const change = (fn: () => void) => {
    fn()
    setPage(1)
  }
  const toggleResult = (r: LoginResult) =>
    change(() =>
      setResults((cur) =>
        RESULTS.map(([k]) => k).filter((k) => (k === r ? !cur.includes(k) : cur.includes(k))),
      ),
    )

  const exportCsv = async () => {
    setExporting(true)
    try {
      const blob = await adminApi.loginLogsCsv(base)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `登录日志-${range.from}-${range.to}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast('导出失败,请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const total = list.data?.total ?? 0
  const pages = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / PAGE_SIZE)))

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">登录日志</h1>
        <Button
          type="button"
          variant="outline"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          导出 CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          从
          <Input
            type="date"
            aria-label="开始日期"
            className="w-40"
            value={range.from}
            onChange={(e) => change(() => setRange((r) => ({ ...r, from: e.target.value })))}
          />
        </label>
        <label className="flex items-center gap-1.5">
          到
          <Input
            type="date"
            aria-label="结束日期"
            className="w-40"
            value={range.to}
            onChange={(e) => change(() => setRange((r) => ({ ...r, to: e.target.value })))}
          />
        </label>
        <Input
          aria-label="搜索登录名或姓名"
          placeholder="搜索登录名或姓名"
          maxLength={50}
          className="w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={suspicious}
            onChange={(e) => change(() => setSuspicious(e.target.checked))}
          />
          只看可疑
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">结果</legend>
        <span className="text-muted-foreground">结果</span>
        {RESULTS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={results.includes(k)} onChange={() => toggleResult(k)} />
            {label}
          </label>
        ))}
      </fieldset>

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
          <table className="w-full min-w-[56rem] text-sm">
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
              {list.data.items.map((r) => (
                <tr key={r.id} className="border-t align-middle">
                  <td className="whitespace-nowrap px-3 py-2">{formatInTz(r.at, localTz())}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.login_name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.user?.display_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge variant={r.result === 'success' ? 'success' : 'danger'}>
                      {RESULT_LABEL[r.result] ?? r.result}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.ip ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{browserSummary(r.user_agent)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.suspicious.map((s) => (
                        <Badge key={s} variant="warning">
                          {SUSPICION_LABEL[s] ?? s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
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
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
