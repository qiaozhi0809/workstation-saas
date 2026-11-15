import { ADMIN_GROUP_LABELS } from '@/shared/components/layout/crumbs'
import type { SidebarGroup } from '@/shared/components/layout/Sidebar'
import { hasPagePerm } from './perms'
import type { AdminGroup, AdminPage } from './pages'

/** 有标题的组按这个顺序排在无标题组之后;每页属于哪个组由 pages.tsx 里的 group 决定 */
const GROUPS: readonly { key: AdminGroup; label: string }[] = [
  { key: 'manage', label: ADMIN_GROUP_LABELS.manage },
  { key: 'reports', label: ADMIN_GROUP_LABELS.reports },
  { key: 'system', label: ADMIN_GROUP_LABELS.system },
]

/**
 * 侧栏分组:只列当前账号有权限、且不是 hidden 的页面,组内顺序同 ADMIN_PAGES。
 * 没标 group 的页面进最前面的无标题组;一项都没有的组不出现;只剩一项的组仍显示组标题。
 */
export function adminGroups(
  pages: AdminPage[],
  perms: readonly string[] | undefined,
): SidebarGroup[] {
  const visible = pages.filter((p) => !p.hidden && hasPagePerm(perms, p.perm))
  // 没有导航入口的子页(班级详情等)挂在父页那一项下面,侧栏照样高亮父页
  const toItem = (p: AdminPage) => {
    const subPages = pages.filter((h) => h.hidden && h.parent === p.path)
    return {
      to: `/admin/${p.path}`,
      label: p.label,
      icon: p.icon,
      ...(subPages.length > 0 ? { alsoActive: subPages.map((h) => `/admin/${h.path}`) } : {}),
    }
  }
  const groups: SidebarGroup[] = [
    { key: 'top', items: visible.filter((p) => !p.group).map(toItem) },
    ...GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      items: visible.filter((p) => p.group === g.key).map(toItem),
    })),
  ]
  return groups.filter((g) => g.items.length > 0)
}
