import { NativeSelect } from '@/shared/components/ui/native-select'
import type { ParentChild } from '@/shared/types/parent'

/** 一个孩子只显示姓名;多个孩子用原生下拉(手机上是系统选择器) */
export default function ChildSwitcher({
  items,
  current,
  onSelect,
}: {
  items: ParentChild[]
  current: ParentChild
  onSelect(id: string): void
}) {
  if (items.length < 2) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium">{current.name}</span>
        {current.status === 'readonly' && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            已毕业/离校
          </span>
        )}
      </span>
    )
  }
  return (
    <NativeSelect
      aria-label="切换孩子"
      className="h-11 min-w-0 max-w-full flex-1 text-base md:text-sm"
      value={current.student_id}
      onChange={(e) => onSelect(e.target.value)}
    >
      {items.map((c) => (
        <option key={c.student_id} value={c.student_id}>
          {c.name}
          {c.status === 'readonly' ? '(已毕业/离校)' : ''}
        </option>
      ))}
    </NativeSelect>
  )
}
