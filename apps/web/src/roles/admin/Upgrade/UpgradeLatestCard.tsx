import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import ConfirmBox from '../Org/ConfirmBox'
import { errMsg } from '../Org/errMsg'
import { dataLines } from './errors'
import { refreshYearData } from './invalidate'

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

export default function UpgradeLatestCard({ onRolledBack }: { onRolledBack?(): void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const latest = useQuery({ queryKey: ['upgrade', 'latest'], queryFn: adminApi.upgradeLatest })
  const rollback = useMutation({
    mutationFn: adminApi.upgradeRollback,
    onSuccess: () => {
      setOpen(false)
      onRolledBack?.()
      toast('已回滚,新学年的班级与注册记录已删除')
      void refreshYearData(qc)
    },
    // 没有可回滚的升级:卡片上的信息已经过时,重取
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'UPGRADE_NOTHING_TO_ROLLBACK') void qc.invalidateQueries({ queryKey: ['upgrade', 'latest'] })
    },
  })
  const up = latest.data
  const err = rollback.error
  const hasData = err instanceof ApiError && err.code === 'UPGRADE_HAS_DATA'
  const close = () => { setOpen(false); rollback.reset() }
  return (
    <Card>
      <CardHeader><CardTitle>最近一次升级</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {latest.isError ? <p role="alert" className="text-destructive">最近一次升级加载失败</p>
          : up === undefined ? <p className="text-muted-foreground">加载中…</p>
          : up === null ? <p className="text-muted-foreground">还没有执行过学年升级</p>
          : (
            <div className="flex flex-wrap items-center gap-3">
              <span>{up.from_year_name} → {up.to_year_name},执行于 {when(up.executed_at)}</span>
              {up.rolled_back && <Badge variant="secondary">已回滚</Badge>}
              <Button variant="outline" size="sm" disabled={up.rolled_back} onClick={() => setOpen(true)}>回滚</Button>
            </div>
          )}
      </CardContent>
      <ConfirmBox open={open} title="回滚学年升级" confirmLabel="确认回滚" busy={rollback.isPending}
        error={err ? (hasData ? err.message : errMsg(err)) : null} onConfirm={() => rollback.mutate()} onClose={close}>
        <p>回滚会删除新学年的班级与注册记录,往年数据不受影响</p>
        {hasData && (
          <ul className="list-disc pl-5 text-destructive">
            {dataLines(err.details).map((l) => <li key={l}>{l}</li>)}
          </ul>
        )}
      </ConfirmBox>
    </Card>
  )
}
