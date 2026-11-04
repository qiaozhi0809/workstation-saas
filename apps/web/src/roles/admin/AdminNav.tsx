import { useEffect, useState } from 'react'
import { ChevronDown, Cog, FileBarChart2, FolderKanban, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import Menu, { MenuLinkItem } from '@/shared/components/overlay/Menu'
import { cn } from '@/shared/lib/utils'
import { useAuthStore } from '@/shared/stores/auth'
import { ADMIN_PAGES, type AdminGroup, type AdminPage } from './pages'

/** 组的名字与图标;哪些页面属于哪个组由 pages.tsx 里每页的 group 决定。图标不与组内页面的图标重复(768–1023 宽只显示图标) */
const GROUPS: Record<AdminGroup, { label: string; icon: LucideIcon }> = {
  manage: { label: '学校管理', icon: FolderKanban },
  reports: { label: '联考与报表', icon: FileBarChart2 },
  system: { label: '系统', icon: Cog },
}

type Entry = { kind: 'link'; page: AdminPage } | { kind: 'group'; group: AdminGroup; pages: AdminPage[] }

/** 按权限过滤后分组:组放在它第一个页面的位置;一项都没有的组不出现,只剩一项的组退化成链接 */
function buildEntries(pages: AdminPage[], perms: readonly string[] | undefined): Entry[] {
  const visible = pages.filter((p) => !p.hidden && perms?.includes(p.perm))
  const members = (g: AdminGroup) => visible.filter((p) => p.group === g)
  const entries: Entry[] = []
  const placed = new Set<AdminGroup>()
  for (const page of visible) {
    if (!page.group) { entries.push({ kind: 'link', page }); continue }
    const list = members(page.group)
    if (list.length === 1) { entries.push({ kind: 'link', page }); continue }
    if (placed.has(page.group)) continue
    placed.add(page.group)
    entries.push({ kind: 'group', group: page.group, pages: list })
  }
  return entries
}

const underPath = (pathname: string, path: string) => {
  const base = `/admin/${path.split('/:')[0]}`
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** 窄屏(< md)沿用原来的横向滚动图标条:浮层是绝对定位,放进 overflow 容器会被裁掉,所以不做下拉 */
function useWide(): boolean {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

const ITEM_BASE = 'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-3'
const itemState = (active: boolean) => (active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')

// 宽屏里 768–1023 只放得下图标(名字进 title 与读屏),≥ 1024 才显示文字
const WIDE_LABEL = 'sr-only lg:not-sr-only'

function NavItem({ page, labelClass = WIDE_LABEL }: { page: AdminPage; labelClass?: string }) {
  const { path, label, icon: Icon } = page
  return (
    <NavLink to={`/admin/${path}`} title={label} className={({ isActive }) => cn(ITEM_BASE, itemState(isActive))}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className={labelClass}>{label}</span>
    </NavLink>
  )
}

function GroupMenu({ group, pages }: { group: AdminGroup; pages: AdminPage[] }) {
  const { label, icon: Icon } = GROUPS[group]
  const { pathname } = useLocation()
  // 按前缀匹配:hidden 的子页(班级信息 org/classes/:id、往年单班 history/classes/:id)都在可见父页的路径之下,自然算本组
  const active = pages.some((p) => underPath(pathname, p.path))
  return (
    <Menu
      label={label}
      side="bottom"
      align="start"
      triggerProps={{ variant: 'ghost', className: cn(ITEM_BASE, itemState(active)), 'aria-current': active ? 'true' : undefined, title: label }}
      trigger={
        <>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className={WIDE_LABEL}>{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </>
      }
    >
      {pages.map(({ path, label: text, icon: PageIcon }) => (
        <MenuLinkItem key={path} to={`/admin/${path}`}>
          <PageIcon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
          {text}
        </MenuLinkItem>
      ))}
    </Menu>
  )
}

/** 管理端顶栏导航:只列当前账号有权限、且不是 hidden 的页面;宽屏按 group 收进下拉,窄屏是可滚动的图标条 */
export default function AdminNav({ pages = ADMIN_PAGES }: { pages?: AdminPage[] }) {
  const perms = useAuthStore((s) => s.user?.admin_perms)
  const wide = useWide()

  if (!wide) {
    const links = pages.filter((p) => !p.hidden && perms?.includes(p.perm))
    // relative:sr-only 标签是 absolute,导航不是定位祖先时它们逃出 overflow-x-auto 的裁剪,窄屏下整页出现横向滚动
    return (
      <nav aria-label="主导航" className="relative flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {links.map((page) => <NavItem key={page.path} page={page} labelClass="sr-only" />)}
      </nav>
    )
  }
  return (
    <nav aria-label="主导航" className="relative flex min-w-0 items-center gap-0.5">
      {buildEntries(pages, perms).map((e) => e.kind === 'link'
        ? <NavItem key={e.page.path} page={e.page} />
        : <GroupMenu key={e.group} group={e.group} pages={e.pages} />)}
    </nav>
  )
}
