import type { ClassPreview } from '@/shared/types/admin'

const KNOWN_ACTIONS = ['promote', 'graduate', 'new'] as const
type KnownAction = (typeof KNOWN_ACTIONS)[number]
// ClassPreview.action 在冻结类型里是 string,先收窄成已知值或 null,再写穷举分支
const knownAction = (a: string): KnownAction | null => ((KNOWN_ACTIONS as readonly string[]).includes(a) ? (a as KnownAction) : null)

/** 每班去向的文字;未知的 action 兜底显示原值和 to_label,不崩溃 */
export function describeClass(c: ClassPreview): string {
  const action = knownAction(c.action)
  const teacher = `班主任:${c.teacher_name ?? '未定'}`
  switch (action) {
    case 'promote':
      return `${c.from_name} → ${c.to_label},${teacher},随班 ${c.follow} 人`
    case 'graduate':
      return `${c.from_name} 毕业,毕业 ${c.graduate} 人`
    case 'new':
      return `新建班 ${c.to_label}(${c.from_name}),${teacher}`
    case null:
      return `${c.from_name} → ${c.to_label}(未识别的去向:${c.action})`
    default:
      return action satisfies never
  }
}
