import type { AdminPerm } from '@/shared/types/admin'

/** 页面权限:一个权限,或"任一即可"的数组 */
export type PagePerm = AdminPerm | readonly AdminPerm[]

/** perms 里有 need(数组时任一)就算有权限 */
export function hasPagePerm(perms: readonly string[] | undefined, need: PagePerm): boolean {
  if (!perms) return false
  return typeof need === 'string' ? perms.includes(need) : need.some((p) => perms.includes(p))
}
