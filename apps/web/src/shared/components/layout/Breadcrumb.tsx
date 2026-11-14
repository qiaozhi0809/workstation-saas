import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
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

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {c.to && !last ? (
                <Link to={c.to} className="truncate rounded-sm hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span
                  className={last ? 'truncate font-medium text-foreground' : 'truncate'}
                  aria-current={last ? 'page' : undefined}
                >
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** 路由模式 `org/classes/:id` 是否匹配 `/admin/` 之后的路径 */
function matches(pattern: string, rest: string): boolean {
  const p = pattern.split('/')
  const r = rest.split('/')
  return p.length === r.length && p.every((seg, i) => seg.startsWith(':') || seg === r[i])
}

/** 管理端:[组] › 页面 [› 隐藏子页]。隐藏页挂在路径前缀最长的可见页之下 */
export function adminCrumbs(pathname: string, pages: AdminPage[]): Crumb[] {
  const rest = pathname.replace(/^\/admin\/?/, '').replace(/\/$/, '')
  const page = pages.find((p) => matches(p.path, rest))
  if (!page) return []
  const crumbs: Crumb[] = []
  const parent = page.hidden
    ? pages
        .filter((p) => !p.hidden && rest.startsWith(`${p.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0]
    : undefined
  const owner = parent ?? page
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
