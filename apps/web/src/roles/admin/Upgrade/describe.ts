import type { ClassPreview } from '@/shared/types/admin'

/** 每班去向的文字;action 只有三个值(L53),分支穷举由 tsc 保证 */
export function describeClass(c: ClassPreview): string {
  const teacher = `班主任:${c.teacher_name ?? '未定'}`
  switch (c.action) {
    case 'promote':
      return `${c.from_name} → ${c.to_label},${teacher},随班 ${c.follow ?? 0} 人`
    case 'graduate':
      return `${c.from_name} 毕业,毕业 ${c.graduate ?? 0} 人`
    case 'new':
      return `新建班 ${c.to_label}(${c.from_name}),${teacher}`
    default:
      return c.action satisfies never
  }
}
