import type { AdminPage } from '@/roles/admin/pages'

export interface Crumb {
  label: string
  to?: string
}

/** 管理端导航组的名字(侧栏与面包屑共用) */
export const ADMIN_GROUP_LABELS = {
  manage: '学校管理',
  reports: '联考与报表',
  system: '系统',
} as const

/** 路由模式 `org/classes/:id` 是否匹配 `/admin/` 之后的路径 */
function matches(pattern: string, rest: string): boolean {
  const p = pattern.split('/')
  const r = rest.split('/')
  return p.length === r.length && p.every((seg, i) => seg.startsWith(':') || seg === r[i])
}

/** 管理端:[组] › 页面 [› 隐藏子页]。隐藏页挂在它的 parent(可见页的 path)之下;与父页同名时只显示父页 */
export function adminCrumbs(pathname: string, pages: AdminPage[]): Crumb[] {
  const rest = pathname.replace(/^\/admin\/?/, '').replace(/\/$/, '')
  const page = pages.find((p) => matches(p.path, rest))
  if (!page) return []
  const parent = page.parent ? pages.find((p) => p.path === page.parent) : undefined
  const owner = parent ?? page
  const crumbs: Crumb[] = []
  if (owner.group) crumbs.push({ label: ADMIN_GROUP_LABELS[owner.group] })
  if (parent) {
    crumbs.push({ label: parent.label, to: `/admin/${parent.path}` })
    if (page.label !== parent.label) crumbs.push({ label: page.label })
  } else {
    crumbs.push({ label: page.label })
  }
  return crumbs
}

const TEACHER_PAGES: readonly { prefix: string; label: string }[] = [
  { prefix: '/teacher/classroom', label: '教室' },
  { prefix: '/teacher/scores', label: '成绩' },
  { prefix: '/teacher/analysis', label: '分析' },
  { prefix: '/teacher/students', label: '学生' },
  { prefix: '/teacher/ai', label: 'AI 助手' },
  { prefix: '/teacher/notices', label: '班级公告' },
  { prefix: '/teacher/preferences', label: '我的偏好' },
]

export function teacherCrumbs(pathname: string): Crumb[] {
  const hit = TEACHER_PAGES.find(
    (p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`),
  )
  return hit ? [{ label: hit.label }] : []
}
