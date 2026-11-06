import type { ParentChild } from '@/shared/types/parent'

/** 只读孩子离开学校的说法(L77):毕业 / 离校;后端给不出原因时沿用合并说法 */
export function leftReasonText(reason: ParentChild['left_reason']): string {
  if (reason === 'graduated') return '毕业'
  if (reason === 'left') return '离校'
  return '毕业 / 离校'
}
