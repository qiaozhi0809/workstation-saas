import { useEffect, useState } from 'react'
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

/** 选项的临时 id:只在本组件内把"哪个选项还没动过"记住,不进 AckSpec */
let seq = 0
const newId = () => `opt-${++seq}`

const without = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set)
  next.delete(id)
  return next
}

/** 去掉末尾连续的、刚添加还没动过的选项:即时校验只看前面这些(L89) */
function settledOptions(options: string[], ids: string[], fresh: ReadonlySet<string>): string[] {
  let n = options.length
  while (n > 0 && fresh.has(ids[n - 1])) n--
  return options.slice(0, n)
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
  const options = value.kind === 'choice' ? value.options : []
  // 每个选项一个临时 id(与 value.options 同序);刚"添加选项"加出来、还没动过的选项 id 记在 fresh 里:
  // 它们在末尾时先不报"选项不能为空",等用户填了(或提交时 ackSpecError)再说;
  // 后面有动过的选项,夹在中间的空行就照报。按 id 记而不按位置,增删选项不用挪下标(L281)
  const [ids, setIds] = useState<string[]>(() => options.map(() => newId()))
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  // 父组件绕过本组件整体替换了 value.options(重置 / 套模板)时,按长度调和 ids:多的裁掉、少的补新 id;
  // 本组件自己的增删在事件里同步改 ids,这里长度相等就什么都不做
  useEffect(() => {
    setIds((cur) =>
      cur.length === options.length
        ? cur
        : cur.length > options.length
          ? cur.slice(0, options.length)
          : [...cur, ...Array.from({ length: options.length - cur.length }, () => newId())],
    )
  }, [options.length])
  const dlError =
    local !== '' && new Date(local).getTime() <= Date.now() ? '截止时间要晚于现在' : null

  const pick = (kind: AckSpec['kind']) => {
    if (kind === value.kind) return
    if (kind === 'choice') {
      onChange({ kind, options: ['', ''], allow_note: false })
      setIds([newId(), newId()])
    } else {
      onChange({ kind })
      setIds([])
    }
    setFresh(new Set())
    if (kind === 'none') {
      setLocal('')
      onDeadlineChange?.(null)
    }
  }
  const setOptions = (next: string[]) => {
    if (value.kind === 'choice') onChange({ ...value, options: next })
  }
  const addOption = () => {
    const id = newId()
    setIds([...ids, id])
    setFresh(new Set([...fresh, id]))
    setOptions([...options, ''])
  }
  const editOption = (i: number, text: string) => {
    if (fresh.has(ids[i])) setFresh(without(fresh, ids[i]))
    setOptions(options.map((o, j) => (j === i ? text : o)))
  }
  const removeOption = (i: number) => {
    if (fresh.has(ids[i])) setFresh(without(fresh, ids[i]))
    setIds(ids.filter((_, j) => j !== i))
    setOptions(options.filter((_, j) => j !== i))
  }
  const onDeadline = (v: string) => {
    setLocal(v)
    onDeadlineChange?.(
      v === '' || Number.isNaN(new Date(v).getTime()) ? null : new Date(v).toISOString(),
    )
  }

  const choiceError =
    value.kind === 'choice' ? optionsError(settledOptions(options, ids, fresh)) : null

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
