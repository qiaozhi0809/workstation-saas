import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { StatusDot } from '@/shared/components/ui/status-dot'
import { TableRow, Td } from '@/shared/components/ui/table'
import type { Account } from '@/shared/types/admin'

const SELF_HINT = '不能冻结自己的账号'

const fmtTime = (iso: string | null) => {
  if (!iso) return '从未登录'
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AccountRow({
  account: a,
  isSelf,
  onEdit,
  onReset,
  onFreeze,
  onUnfreeze,
  onResetTotp,
}: {
  account: Account
  isSelf: boolean
  onEdit(): void
  onReset(): void
  onFreeze(): void
  onUnfreeze(): void
  onResetTotp(): void
}) {
  const totp = a.totp_enabled === true
  const frozen = a.status === 'frozen'
  return (
    <TableRow>
      <Td className="font-medium">
        {a.display_name}
        {totp && (
          <Badge variant="info" className="ml-1.5 align-middle">
            两步验证
          </Badge>
        )}
      </Td>
      <Td>{a.login_name}</Td>
      {/* 身份列至少 8rem 宽:徽章不逐字竖排(重审 P2-2) */}
      <Td className="min-w-[8rem]">
        {a.roles.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-wrap gap-1">
            {a.roles.map((r) => (
              <Badge key={`${r.role}-${r.label}`} variant="neutral">
                {r.label}
              </Badge>
            ))}
          </div>
        )}
      </Td>
      <Td>{a.employee_no ?? '—'}</Td>
      <Td className="text-muted-foreground">{fmtTime(a.last_login_at)}</Td>
      <Td>
        <StatusDot tone={frozen ? 'danger' : 'success'}>{frozen ? '已冻结' : '在用'}</StatusDot>
      </Td>
      <Td align="end">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex gap-1">
            <Button type="button" variant="link" size="sm" onClick={onEdit}>
              编辑
            </Button>
            {!isSelf && (
              <Button type="button" variant="link" size="sm" onClick={onReset}>
                重置密码
              </Button>
            )}
            {totp && !isSelf && (
              <Button type="button" variant="link" size="sm" onClick={onResetTotp}>
                重置两步验证
              </Button>
            )}
            {frozen ? (
              <Button type="button" variant="link" size="sm" onClick={onUnfreeze}>
                解冻
              </Button>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={isSelf}
                title={isSelf ? SELF_HINT : undefined}
                aria-describedby={isSelf ? `self-hint-${a.id}` : undefined}
                onClick={onFreeze}
              >
                冻结
              </Button>
            )}
          </div>
          {isSelf && !frozen && (
            <span id={`self-hint-${a.id}`} className="text-xs text-muted-foreground">
              {SELF_HINT}
            </span>
          )}
        </div>
      </Td>
    </TableRow>
  )
}
