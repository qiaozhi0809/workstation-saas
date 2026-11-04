import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { Account } from '@/shared/types/admin'

const SELF_HINT = '不能冻结自己的账号'

const fmtTime = (iso: string | null) => {
  if (!iso) return '从未登录'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AccountRow({ account: a, isSelf, onEdit, onReset, onFreeze, onUnfreeze }: {
  account: Account; isSelf: boolean
  onEdit(): void; onReset(): void; onFreeze(): void; onUnfreeze(): void
}) {
  const frozen = a.status === 'frozen'
  return (
    <tr className="border-t align-middle">
      <td className="whitespace-nowrap px-3 py-2 font-medium">{a.display_name}</td>
      <td className="whitespace-nowrap px-3 py-2">{a.login_name}</td>
      <td className="px-3 py-2">
        {a.roles.length === 0 ? '—' : (
          <div className="flex flex-wrap gap-1">
            {a.roles.map((r) => <Badge key={`${r.role}-${r.label}`} variant="neutral">{r.label}</Badge>)}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{a.employee_no ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtTime(a.last_login_at)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <Badge variant={frozen ? 'danger' : 'success'}>{frozen ? '已冻结' : '在用'}</Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <div className="flex flex-col items-start gap-0.5">
          <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>编辑</Button>
          {!isSelf && <Button type="button" variant="ghost" size="sm" onClick={onReset}>重置密码</Button>}
          {frozen ? (
            <Button type="button" variant="ghost" size="sm" onClick={onUnfreeze}>解冻</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={isSelf} title={isSelf ? SELF_HINT : undefined}
                aria-describedby={isSelf ? `self-hint-${a.id}` : undefined} onClick={onFreeze}>
                冻结
              </Button>
            </>
          )}
          </div>
          {isSelf && !frozen && <span id={`self-hint-${a.id}`} className="text-xs text-muted-foreground">{SELF_HINT}</span>}
        </div>
      </td>
    </tr>
  )
}
