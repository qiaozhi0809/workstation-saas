import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, Circle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { useAuthStore } from '@/shared/stores/auth'

export type SetupKey =
  'school' | 'year' | 'classes' | 'accounts' | 'assignments' | 'timetable' | 'cameras' | 'ai'

/** `GET /admin/setup-checklist` 的一项:done 之外的现状文字由后端给,`to` 是管理端路径 */
export interface SetupItem {
  key: SetupKey
  done: boolean
  detail: string
  to: string
}

/** 各项的名字只在前端维护;使用手册按这里的叫法写 */
const SETUP_LABELS: Record<SetupKey, string> = {
  school: '年级与学段',
  year: '当前学年',
  classes: '班级',
  accounts: '教职工账号',
  assignments: '班主任',
  timetable: '课表',
  cameras: '摄像头',
  ai: 'AI 服务',
}

const fetchChecklist = () => api<SetupItem[]>('GET', '/admin/setup-checklist')

const CARD = 'flex flex-col gap-3 rounded-lg border bg-card p-4'

const canSee = (perms: readonly string[] | undefined) =>
  perms?.some((p) => p === 'org.manage' || p === 'settings.manage') ?? false

/**
 * 开学准备清单,挂在今日关注顶部。只对 org.manage / settings.manage 显示(年级组长看不到);
 * 全部完成时折叠成一行"开学准备已完成",可展开;有未完成项时显示进度与逐项链接。
 */
export function SetupChecklist() {
  const allowed = useAuthStore((s) => canSee(s.user?.admin_perms))
  const q = useQuery({
    queryKey: ['admin', 'setup-checklist'],
    queryFn: fetchChecklist,
    enabled: allowed,
  })
  const [expanded, setExpanded] = useState(false)

  if (!allowed) return null
  // 加载中 / 失败也占着同一张卡的位置,数据到了下面的 KPI 行不会跳
  if (!q.data)
    return (
      <section aria-label="开学准备" className={CARD}>
        {q.isError ? (
          <ErrorState
            title="开学准备清单加载失败"
            onRetry={() => void q.refetch()}
            retrying={q.isFetching}
            className="py-2"
          />
        ) : (
          <LoadingState label="开学准备清单加载中…" className="justify-start py-2" />
        )}
      </section>
    )

  const items = q.data
  const done = items.filter((i) => i.done).length
  const allDone = done === items.length
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0

  return (
    <section aria-label="开学准备" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{allDone ? '开学准备已完成' : '开学准备'}</h2>
        {allDone ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '展开'}
            <ChevronDown
              className={cn('ml-1 h-4 w-4 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">{`已完成 ${done} / ${items.length}`}</span>
        )}
      </div>
      {!allDone && (
        <div
          role="progressbar"
          aria-label="开学准备进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(!allDone || expanded) && (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="sr-only">{item.done ? '已完成' : '未完成'}</span>
              <div className="flex min-w-0 flex-col">
                <Link
                  to={item.to}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {SETUP_LABELS[item.key]}
                </Link>
                <span className="break-words text-muted-foreground">{item.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
