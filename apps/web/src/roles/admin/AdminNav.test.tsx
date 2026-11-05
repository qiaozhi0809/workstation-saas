import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Building2, Sun, Users } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import AdminNav from './AdminNav'
import { ADMIN_PAGES, type AdminPage } from './pages'

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
    expect(top()).toEqual(['今日关注', '全校看板', '学校管理', '联考与报表', '系统', '通知'])
    for (const g of ['学校管理', '联考与报表', '系统']) {
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
    expect(open('联考与报表')).toEqual([
      ['年级联考', '/admin/grade-exams'],
      ['成绩汇总', '/admin/reports/scores'],
      ['考勤报告', '/admin/reports/attendance'],
    ])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(open('学校管理')).toEqual([
      ['组织架构', '/admin/org'],
      ['账号', '/admin/accounts'],
      ['学校设置', '/admin/settings'],
      ['学年升级', '/admin/upgrade'],
      ['往年班级', '/admin/history'],
    ])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(open('系统')).toEqual([
      ['审计日志', '/admin/audit'],
      ['AI 使用', '/admin/ai/usage'],
      ['AI 配置', '/admin/ai/config'],
    ])
  })

  it.each([
    ['dean', ['今日关注', '全校看板', '学校管理', '联考与报表', 'AI 使用', '通知']],
    ['gradeHead', ['今日关注', '全校看板', '联考与报表', '通知', '往年班级']],
    ['itAdmin', ['学校管理', '系统']],
  ])(
    'filters by permission for %s: empty groups vanish, single-item groups become plain links',
    (role, expected) => {
      setPerms(PERMS[role])
      renderNav()
      expect(top()).toEqual(expected)
    },
  )

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
    expect(top()).toEqual(['今日关注', '全校看板', '联考与报表', '往年班级'])
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
    expect(
      within(el)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual([
      '/admin/today',
      '/admin/board',
      '/admin/org',
      '/admin/accounts',
      '/admin/settings',
      '/admin/grade-exams',
      '/admin/reports/scores',
      '/admin/reports/attendance',
      '/admin/audit',
      '/admin/ai/usage',
      '/admin/ai/config',
      '/admin/notices',
      '/admin/upgrade',
      '/admin/history',
    ])
    expect(el).toHaveClass('relative', 'overflow-x-auto')
  })

  it('switches layout when the viewport crosses 768 and unsubscribes on unmount', () => {
    const vp = mockViewport(1024)
    const { unmount } = renderNav()
    expect(within(nav()).getAllByRole('button')).toHaveLength(3)
    vp.resize(600)
    expect(within(nav()).queryAllByRole('button')).toHaveLength(0)
    expect(within(nav()).getAllByRole('link')).toHaveLength(14)
    vp.resize(900)
    expect(within(nav()).getAllByRole('button')).toHaveLength(3)
    unmount()
    expect(vp.removed).toHaveBeenCalled()
    expect(vp.listeners.size).toBe(0)
  })
})
