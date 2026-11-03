import type { AiStatus } from '@/shared/types/ai'

/** 「隐去学生姓名」开关:学校强制时固定勾选并禁用,旁注「学校要求」。 */
export default function MaskToggle({ status, checked, onChange }: {
  status: AiStatus | undefined
  checked: boolean
  onChange(v: boolean): void
}) {
  const forced = status?.mask_forced === true
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={forced || checked}
          disabled={forced}
          onChange={(e) => onChange(e.target.checked)}
        />
        隐去学生姓名
      </label>
      {forced && <span className="text-xs text-muted-foreground">学校要求</span>}
    </span>
  )
}
