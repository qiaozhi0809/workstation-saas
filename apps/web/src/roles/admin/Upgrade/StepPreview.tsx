import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import type { ClassPreview, UpgradePlan } from '@/shared/types/admin'
import ConfirmBox from '../Org/ConfirmBox'
import { errMsg } from '../Org/errMsg'
import { problemOf, isStale } from './errors'
import { describeClass } from './describe'
import { toRequest } from './planOps'

function Counts({ c }: { c: ClassPreview }) {
  const parts = [
    ['随班', c.follow], ['留级转入', c.repeat_in], ['留级转出', c.repeat_out], ['离校', c.leave], ['毕业', c.graduate],
  ] as const
  return (
    <span className="text-xs text-muted-foreground">
      {parts.map(([k, n]) => `${k} ${n}`).join(' · ')}
    </span>
  )
}

export default function StepPreview({ plan, onApplied, onError }: {
  plan: UpgradePlan
  onApplied(): void
  /** 返回 true 表示已作为方案问题 / 过期处理(跳转或提示) */
  onError(e: unknown): boolean
}) {
  const body = useMemo(() => toRequest(plan), [plan])
  const [confirm, setConfirm] = useState(false)
  const handle = useRef(onError)
  useEffect(() => { handle.current = onError })
  const preview = useQuery({
    queryKey: ['upgrade', 'preview', body], queryFn: () => adminApi.upgradePreview(body), retry: false, gcTime: 0,
  })
  useEffect(() => { if (preview.error) handle.current(preview.error) }, [preview.error])
  const apply = useMutation({
    mutationFn: () => adminApi.upgradeApply(body),
    onSuccess: () => { setConfirm(false); onApplied() },
    onError: (e) => { if (problemOf(e) || isStale(e)) { setConfirm(false); handle.current(e) } },
  })
  const pv = preview.data
  return (
    <div className="grid gap-3">
      {preview.isLoading && <LoadingState />}
      {preview.isError && !problemOf(preview.error) && !isStale(preview.error) && (
        <ErrorState title="预览失败" description={errMsg(preview.error)} onRetry={() => void preview.refetch()} />
      )}
      {pv && (
        <>
          <p className="text-sm">新学年:<span className="font-medium">{pv.new_year}</span></p>
          <ul className="grid gap-2">
            {pv.classes.map((c, i) => (
              <li key={i} className="grid gap-0.5 rounded-md border px-3 py-2 text-sm">
                <span>{describeClass(c)}</span>
                <Counts c={c} />
              </li>
            ))}
          </ul>
          {(pv.warnings ?? []).length > 0 && (
            <ul className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {pv.warnings.map((w) => <li key={w}>警告:{w}</li>)}
            </ul>
          )}
          <div>
            <Button onClick={() => setConfirm(true)}>执行升级</Button>
          </div>
        </>
      )}
      <ConfirmBox open={confirm} title="执行升级" confirmLabel="确认执行" busy={apply.isPending}
        error={apply.isError && !problemOf(apply.error) && !isStale(apply.error) ? errMsg(apply.error) : null}
        onConfirm={() => apply.mutate()} onClose={() => { setConfirm(false); apply.reset() }}>
        <p>执行后新学年立即生效</p>
      </ConfirmBox>
    </div>
  )
}
