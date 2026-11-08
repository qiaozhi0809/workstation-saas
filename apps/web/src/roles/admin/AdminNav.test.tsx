import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Building2, Sun, Users } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import AdminNav from './AdminNav'
import { hasPagePerm } from './perms'
import { ADMIN_PAGES, type AdminGroup, type AdminPage } from './pages'

const PERMS: Record<string, AdminPerm[]> = {
  principal: [
    'school.view',
    'org.manage',
    'account.manage',
    'settings.manage',
    'audit.read',
    'ai.usage',
    'notice.send',
    'exam.grade_write',
    'year.upgrade',
  ],
  dean: [
    'school.view',
    'org.manage',
    'ai.usage',
    'notice.send',
    'exam.grade_write',
    'year.upgrade',
  ],
  gradeHead: ['school.view', 'notice.send', 'exam.grade_write'],
  itAdmin: ['org.manage', 'account.manage', 'settings.manage', 'audit.read'],
}

const setPerms = (admin_perms: AdminPerm[]) =>
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    lastContext: null,
    user: {
      id: 'u',
      display_name: '张主任',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })

const renderNav = (pages: AdminPage[] = ADMIN_PAGES, entry = '/admin/today') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AdminNav pages={pages} />
    </MemoryRouter>,
  )
const nav = () => screen.getByRole('navigation', { name: '主导航' })
/** 顶层入口:直接显示的链接与组按钮,按 DOM 顺序 */
const top = () =>
  Array.from(nav().querySelectorAll('a, button')).map((el) => el.textContent?.trim())

// ---- 期望从 ADMIN_PAGES 派生(L214):新增页面只改 pages.tsx,这里的三处清单不用再跟着改 ----
const GROUP_LABEL: Record<AdminGroup, string> = {
  manage: '学校管理',
  reports: '联考与报表',
  system: '系统',
}
/** 该权限集能看到的页面(不含 hidden),保持数组顺序 */
const visible = (perms: AdminPerm[], pages = ADMIN_PAGES) =>
  pages.filter((p) => !p.hidden && hasPagePerm(perms, p.perm))
/** 顶层条目:组放在它第一个页面的位置;按权限过滤后只剩一项的组退化成那一页的链接 */
function expectedTop(perms: AdminPerm[]): string[] {
  const list = visible(perms)
  const out: string[] = []
  const placed = new Set<AdminGroup>()
  for (const p of list) {
    const members = p.group ? list.filter((x) => x.group === p.group) : []
    if (!p.group || members.length === 1) out.push(p.label)
    else if (!placed.has(p.group)) {
      placed.add(p.group)
      out.push(GROUP_LABEL[p.group])
    }
  }
  return out
}
/** 某个组下拉里的 [名字, href],按数组顺序 */
const expectedMenu = (group: AdminGroup, perms: AdminPerm[]) =>
  visible(perms)
    .filter((p) => p.group === group)
    .map((p) => [p.label, `/admin/${p.path}`])
const expectedHrefs = (perms: AdminPerm[]) => visible(perms).map((p) => `/admin/${p.path}`)

/** 按 min-width 查询串与当前宽度求值的 matchMedia;resize 会通知已订阅的监听器 */
function mockViewport(width: number) {
  let w = width
  const listeners = new Set<() => void>()
  const removed = vi.fn()
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0)
    return {
      get matches() {
        return w >= min
      },
      media: q,
      addEventListener: (_: string, fn: () => void) => {
        listeners.add(fn)
      },
      removeEventListener: (_: string, fn: () => void) => {
        removed()
        listeners.delete(fn)
      },
    }
  })
  return {
    listeners,
    removed,
    resize: (n: number) => {
      w = n
      act(() => listeners.forEach((f) => f()))
    },
  }
}

beforeEach(() => setPerms(PERMS.principal))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.getState().logout()
})

describe('grouped nav (≥ 768)', () => {
  it('shows direct links and three groups for a principal, in page order', () => {
    mockViewport(768) // 恰好 768 就是宽屏
    renderNav()
    const expected = expectedTop(PERMS.principal)
    // 派生出来的清单至少要像样:三个组都在,直接链接也在,再逐项对 DOM
    expect(expected).toEqual(expect.arrayContaining(['今日关注', '学校管理', '联考与报表', '系统']))
    expect(top()).toEqual(expected)
    for (const g of Object.values(GROUP_LABEL)) {
      expect(screen.getByRole('button', { name: g })).toHaveAttribute('aria-haspopup', 'menu')
    }
  })

  it('keeps every entry reachable: group items live in the menu, in array order', () => {
    renderNav()
    const open = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name }))
      const items = within(screen.getByRole('menu', { name })).getAllByRole('menuitem')
      return items.map((i) => [i.textContent?.trim(), i.getAttribute('href')])
    }
    for (const group of Object.keys(GROUP_LABEL) as AdminGroup[]) {
      const expected = expectedMenu(group, PERMS.principal)
      expect(expected.length).toBeGreaterThan(1) // 校长看得到每个组的不止一项,否则组会退化成链接
      expect(open(GROUP_LABEL[group])).toEqual(expected)
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    }
  })

  it.each(['dean', 'gradeHead', 'itAdmin'])(
    'filters by permission for %s: empty groups vanish, single-item groups become plain links',
    (role) => {
      setPerms(PERMS[role])
      renderNav()
      expect(top()).toEqual(expectedTop(PERMS[role]))
    },
  )

  it('shows 今日关注 to org.manage / settings.manage holders without school.view (L398)', () => {
    for (const perms of [['org.manage'], ['settings.manage']] as AdminPerm[][]) {
      setPerms(perms)
      renderNav()
      expect(within(nav()).getByRole('link', { name: '今日关注' })).toHaveAttribute(
        'href',
        '/admin/today',
      )
      // 其余 school.view 页面(看板)仍不给
      expect(within(nav()).queryByRole('link', { name: '全校看板' })).toBeNull()
      cleanup()
    }
  })

  it('turns a one-item group into a real link, not a dropdown', () => {
    setPerms(PERMS.dean)
    renderNav()
    const link = within(nav()).getByRole('link', { name: 'AI 使用' })
    expect(link).toHaveAttribute('href', '/admin/ai/usage')
    expect(within(nav()).queryByRole('button', { name: '系统' })).toBeNull()
  })

  it('hides a group when nothing in it is permitted', () => {
    setPerms(['school.view'])
    renderNav()
    // 只有 school.view:系统组一项都没有 → 不显示;学校管理组只剩"往年班级" → 退化成链接;联考与报表还有 2 项 → 仍是下拉
    expect(top()).toEqual(expectedTop(['school.view']))
    expect(within(nav()).queryByRole('button', { name: '系统' })).toBeNull()
    expect(within(nav()).queryByRole('button', { name: '学校管理' })).toBeNull()
    expect(within(nav()).getByRole('link', { name: '往年班级' })).toHaveAttribute(
      'href',
      '/admin/history',
    )
    expect(within(nav()).getByRole('button', { name: '联考与报表' })).toBeInTheDocument()
  })

  it('marks the group button active on any of its routes, including hidden sub-routes', () => {
    renderNav(ADMIN_PAGES, '/admin/reports/attendance')
    expect(screen.getByRole('button', { name: '联考与报表' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: '学校管理' })).not.toHaveAttribute('aria-current')
    cleanup()
    renderNav(ADMIN_PAGES, '/admin/history/classes/c1')
    expect(screen.getByRole('button', { name: '学校管理' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: '联考与报表' })).not.toHaveAttribute('aria-current')
    cleanup()
    renderNav(ADMIN_PAGES, '/admin/org/classes/c1')
    expect(screen.getByRole('button', { name: '学校管理' })).toHaveAttribute('aria-current', 'true')
  })

  it('keeps plain links active as before', () => {
    renderNav(ADMIN_PAGES, '/admin/board')
    expect(screen.getByRole('link', { name: '全校看板' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '今日关注' })).not.toHaveAttribute('aria-current')
  })

  it('opens with the arrow key, moves with arrows and closes with Escape', () => {
    renderNav()
    const btn = screen.getByRole('button', { name: '系统' })
    expect(btn.tagName).toBe('BUTTON') // 原生按钮:回车 / 空格即点击
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: '系统' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('closes the menu after choosing an item', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: '联考与报表' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '成绩汇总' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // L58 / L276:导航下拉的键盘——↑ 打开时焦点落在最后一项(APG,由 Menu 本体处理),开着时 ↑ 也跳到最后一项
  it('opens with ArrowUp focusing the last item, and ArrowUp on the open trigger jumps there too', () => {
    renderNav()
    const btn = screen.getByRole('button', { name: '系统' })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowUp' })
    const menu = screen.getByRole('menu', { name: '系统' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items[items.length - 1]).toHaveFocus()
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    expect(items[0]).toHaveFocus()
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowUp' })
    expect(items[items.length - 1]).toHaveFocus()
    expect(screen.getByRole('menu', { name: '系统' })).toBeInTheDocument()
  })

  it('activates a focused menu item with Space: navigates and closes', () => {
    function Probe() {
      return <output data-testid="path">{useLocation().pathname}</output>
    }
    render(
      <MemoryRouter initialEntries={['/admin/today']}>
        <AdminNav pages={ADMIN_PAGES} />
        <Probe />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '联考与报表' })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: '联考与报表' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    const item = within(menu).getByRole('menuitem', { name: '成绩汇总' })
    expect(item).toHaveFocus()
    const space = fireEvent.keyDown(item, { key: ' ' })
    expect(space).toBe(false) // 已 preventDefault:空格不再滚动页面
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/reports/scores')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveFocus()
  })

  it('marks the current page inside the open menu', () => {
    renderNav(ADMIN_PAGES, '/admin/org/classes/c1')
    fireEvent.click(screen.getByRole('button', { name: '学校管理' }))
    const items = within(screen.getByRole('menu', { name: '学校管理' })).getAllByRole('menuitem')
    // 只断言 aria-current:当前页那一项带 page,其余没有(视觉上的勾是它的装饰,不单独断言)
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: '组织架构' }),
    ).toHaveAttribute('aria-current', 'page')
    expect(items.filter((i) => i.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('is data-driven: any page with a group lands in that group', () => {
    const pages: AdminPage[] = [
      { path: 'today', label: '今日关注', icon: Sun, perm: 'school.view', element: null },
      {
        path: 'x-one',
        label: '甲页',
        icon: Building2,
        perm: 'org.manage',
        element: null,
        group: 'system',
      },
      {
        path: 'x-two',
        label: '乙页',
        icon: Users,
        perm: 'account.manage',
        element: null,
        group: 'system',
      },
    ]
    setPerms(['school.view', 'org.manage', 'account.manage'])
    renderNav(pages, '/admin/x-two')
    expect(top()).toEqual(['今日关注', '系统']) // 虚构路径与页名:分组只由 group 字段决定
    expect(screen.getByRole('button', { name: '系统' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows pages without a group as plain links', () => {
    const pages: AdminPage[] = [
      { path: 'org', label: '组织架构', icon: Building2, perm: 'org.manage', element: null },
    ]
    setPerms(['org.manage'])
    renderNav(pages, '/admin/org')
    expect(top()).toEqual(['组织架构'])
  })
})

describe('narrow nav (< 768)', () => {
  it('keeps the flat, scrollable icon row with every entry as a link and no dropdowns', () => {
    mockViewport(500)
    renderNav()
    const el = nav()
    expect(within(el).queryAllByRole('button')).toHaveLength(0)
    const expected = expectedHrefs(PERMS.principal)
    // 校长没有 camera.manage:摄像头页不在;hidden 的子页也不在
    expect(expected).not.toContain('/admin/cameras')
    expect(expected).toEqual(expect.arrayContaining(['/admin/today', '/admin/history']))
    expect(
      within(el)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual(expected)
    expect(el).toHaveClass('relative', 'overflow-x-auto')
  })

  it('switches layout when the viewport crosses 768 and unsubscribes on unmount', () => {
    const vp = mockViewport(1024)
    const { unmount } = renderNav()
    const groups = Object.keys(GROUP_LABEL).length
    expect(within(nav()).getAllByRole('button')).toHaveLength(groups)
    vp.resize(600)
    expect(within(nav()).queryAllByRole('button')).toHaveLength(0)
    expect(within(nav()).getAllByRole('link')).toHaveLength(visible(PERMS.principal).length)
    vp.resize(900)
    expect(within(nav()).getAllByRole('button')).toHaveLength(groups)
    unmount()
    expect(vp.removed).toHaveBeenCalled()
    expect(vp.listeners.size).toBe(0)
  })
})
