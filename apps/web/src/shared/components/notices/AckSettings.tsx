import { useState } from 'react'
import { Input } from '@/shared/components/ui/input'
import { Button } from '@/shared/components/ui/button'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import type { AckSpec } from '@/shared/types/admin'
import { MAX_OPTIONS, MIN_OPTIONS, optionsError } from './ackSpec'

const MAX_OPTION_LEN = 20

const KINDS: readonly { kind: AckSpec['kind']; label: string }[] = [
  { kind: 'none', label: '不要回执' },
  { kind: 'confirm', label: '已知晓' },
  { kind: 'choice', label: '单选' },
]

/** ISO 时刻 -> datetime-local 输入值(本地时区,精确到分) */
function toLocalInput(iso: string | null | undefined): string {
  return iso ? formatInTz(iso, localTz()).replace(' ', 'T') : ''
}

/**
 * 回执设置:不要回执 / 已知晓 / 单选。
 * - value / onChange:回执方式(AckSpec)受控。
 * - deadline(ISO 或 null)/ onDeadlineChange(ISO 或 null):截止时间,可选;不传 deadline 时组件内部自己记着,只用于显示错误。
 * 校验错误只显示,不阻止调用方;调用方提交前用 ackSpecError 拦截——选项文案与这里同出 optionsError(L89)。
 */
export default function AckSettings({
  value,
  onChange,
  deadline,
  onDeadlineChange,
}: {
  value: AckSpec
  onChange(v: AckSpec): void
  deadline?: string | null
  onDeadlineChange?(iso: string | null): void
}) {
  const [local, setLocal] = useState(() => toLocalInput(deadline))
  // 从这个下标起,末尾的选项都是刚"添加选项"加出来、还没动过的空行:先不报"选项不能为空",
  // 等用户填了(或提交时 ackSpecError)再说;动过其中一个,它前面没动过的空行就夹在中间了,照报
  const [freshFrom, setFreshFrom] = useState<number | null>(null)
  const dlError =
    local !== '' && new Date(local).getTime() <= Date.now() ? '截止时间要晚于现在' : null

  const pick = (kind: AckSpec['kind']) => {
    if (kind === value.kind) return
    if (kind === 'choice') onChange({ kind, options: ['', ''], allow_note: false })
    else onChange({ kind })
    setFreshFrom(null)
    if (kind === 'none') {
      setLocal('')
      onDeadlineChange?.(null)
    }
  }
  const options = value.kind === 'choice' ? value.options : []
  const setOptions = (next: string[]) => {
    if (value.kind === 'choice') onChange({ ...value, options: next })
  }
  const addOption = () => {
    setFreshFrom((f) => f ?? options.length)
    setOptions([...options, ''])
  }
  const editOption = (i: number, text: string) => {
    if (freshFrom !== null && i >= freshFrom) setFreshFrom(i + 1 < options.length ? i + 1 : null)
    setOptions(options.map((o, j) => (j === i ? text : o)))
  }
  const removeOption = (i: number) => {
    if (freshFrom !== null)
      setFreshFrom(
        i < freshFrom ? freshFrom - 1 : freshFrom < options.length - 1 ? freshFrom : null,
      )
    setOptions(options.filter((_, j) => j !== i))
  }
  const onDeadline = (v: string) => {
    setLocal(v)
    onDeadlineChange?.(
      v === '' || Number.isNaN(new Date(v).getTime()) ? null : new Date(v).toISOString(),
    )
  }

  const choiceError =
    value.kind === 'choice' ? optionsError(options.slice(0, freshFrom ?? undefined)) : null

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="回执" className="flex flex-wrap gap-4">
        {KINDS.map((k) => (
          <label key={k.kind} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="ack-kind"
              checked={value.kind === k.kind}
              onChange={() => pick(k.kind)}
            />
            {k.label}
          </label>
        ))}
      </div>

      {value.kind === 'choice' && (
        <div className="flex flex-col gap-2">
          {value.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`选项 ${i + 1}`}
                maxLength={MAX_OPTION_LEN}
                value={opt}
                onChange={(e) => editOption(i, e.target.value)}
              />
              {value.options.length > MIN_OPTIONS && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`删除选项 ${i + 1}`}
                  onClick={() => removeOption(i)}
                >
                  删除
                </Button>
              )}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={value.options.length >= MAX_OPTIONS}
              onClick={addOption}
            >
              添加选项
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.allow_note}
              onChange={(e) => onChange({ ...value, allow_note: e.target.checked })}
            />
            允许留言
          </label>
          {choiceError && (
            <p role="alert" className="text-sm text-destructive">
              {choiceError}
            </p>
          )}
        </div>
      )}

      {value.kind !== 'none' && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0">截止时间</span>
            <Input
              type="datetime-local"
              aria-label="截止时间"
              className="min-w-0"
              value={local}
              onChange={(e) => onDeadline(e.target.value)}
            />
          </label>
          {dlError && (
            <p role="alert" className="text-sm text-destructive">
              {dlError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
