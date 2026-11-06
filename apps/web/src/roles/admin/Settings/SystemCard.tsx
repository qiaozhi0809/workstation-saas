import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { downloadBlob } from '@/shared/lib/download'
import { useAuthStore } from '@/shared/stores/auth'
import type { SystemInfo } from '@/shared/types/admin'

const DAY_MS = 24 * 60 * 60 * 1000
/** 备份定时器每天跑一次;超过两天没有新备份就当它坏了 */
const BACKUP_STALE_MS = 2 * DAY_MS

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * 备份告警(L184):定时器失败只进 journal,这张卡是管理员唯一能看到备份状况的地方,
 * 所以从未备份、或上次备份距今超过 48 小时都要醒目地说出来;正常时只在"上次备份"行显示时间。
 */
function backupAlert(last: SystemInfo['last_backup']): string | null {
  if (last === null) return '从未备份,请检查定时任务'
  const age = Date.now() - new Date(last.at).getTime()
  if (age <= BACKUP_STALE_MS) return null
  return `上次备份是 ${Math.floor(age / DAY_MS)} 天前,请检查定时任务`
}

/** 系统信息与诊断包导出;只有 settings.manage 看得到 */
export default function SystemCard() {
  const allowed = useAuthStore((s) => s.user?.admin_perms?.includes('settings.manage') ?? false)
  const q = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: adminApi.systemInfo,
    enabled: allowed,
  })
  const [busy, setBusy] = useState(false)

  if (!allowed) return null

  const exportDiag = async () => {
    setBusy(true)
    try {
      const { blob, filename } = await adminApi.downloadDiagnostics()
      downloadBlob(blob, filename)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '导出失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  let body
  if (q.isPending) body = <LoadingState />
  else if (q.isError) {
    body = (
      <ErrorState
        title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  } else {
    const info = q.data
    const alert = backupAlert(info.last_backup)
    body = (
      <div className="space-y-3">
        {alert && (
          <p
            role="alert"
            className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            {alert}
          </p>
        )}
        <dl className="space-y-2">
          <Row label="版本">{info.version}</Row>
          <Row label="数据库迁移">{info.migration}</Row>
          <Row label="数据库大小">{formatBytes(info.db_size_bytes)}</Row>
          <Row label="上次备份">
            {info.last_backup === null
              ? '还没有备份记录'
              : new Date(info.last_backup.at).toLocaleString('zh-CN')}
          </Row>
        </dl>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>系统</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {body}
        <p className="text-xs text-muted-foreground">
          诊断包不含学生、成绩等业务数据,可以发给技术支持
        </p>
        <div className="flex justify-end">
          <Button type="button" disabled={busy} onClick={() => void exportDiag()}>
            导出诊断信息
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
