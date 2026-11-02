import type { ClassPerm } from '@/shared/types/classroom'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'

export type ClassroomUiMode = 'daily' | 'attendance' | 'review' | 'seating'

// 成绩模式属于 M2b,这里不出现
const MODES: { mode: ClassroomUiMode; label: string; perm: ClassPerm | null }[] = [
  { mode: 'daily', label: '日常', perm: null },
  { mode: 'attendance', label: '考勤', perm: 'attendance.read' },
  { mode: 'review', label: '点评', perm: 'review.read' },
  { mode: 'seating', label: '排座', perm: 'seating.write' },
]

/** 我的权限下可用的模式(日常始终可用),按模式条顺序。 */
// eslint-disable-next-line react-refresh/only-export-components
export function modesFor(perms: readonly ClassPerm[]): ClassroomUiMode[] {
  return MODES.filter((m) => !m.perm || perms.includes(m.perm)).map((m) => m.mode)
}

export default function ModeBar({ mode, perms, onChange }: {
  mode: ClassroomUiMode
  perms: readonly ClassPerm[]
  onChange(mode: ClassroomUiMode): void
}) {
  const allowed = modesFor(perms)
  const items = MODES.filter((m) => allowed.includes(m.mode)).map((m) => ({ value: m.mode, label: m.label }))
  return (
    <SegmentedTabs label="教室模式" variant="pill" items={items} value={mode} onChange={onChange} />
  )
}
