import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Building2, Sun } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu'
import { Sidebar, type SidebarGroup } from './Sidebar'
import { DRAWER_BREAKPOINT } from './useSidebarState'
import SidebarShell from './SidebarShell'
import { Breadcrumb } from './Breadcrumb'
import { adminCrumbs, teacherCrumbs } from './crumbs'
import { ADMIN_PAGES } from '@/roles/admin/pages'

const GROUPS: SidebarGroup[] = [
  { key: 'top', items: [{ to: '/admin/today', label: '今日关注', icon: Sun }] },
  {
    key: 'manage',
    label: '学校管理',
    items: [{ to: '/admin/org', label: '组织架构', icon: Building2 }],
  },
]

function mockWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const Wrap = ({ children, at = '/admin/org' }: { children: ReactNode; at?: string }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[at]}>{children}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  localStorage.clear()
  mockWidth(1440)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const sidebar = (p: Partial<React.ComponentProps<typeof Sidebar>> = {}) =>
  render(
    <Wrap>
      <Sidebar
        groups={GROUPS}
        collapsed={false}
        onToggle={() => {}}
        header={<span>品牌</span>}
        footer={<span>脚</span>}
        {...p}
      />
    </Wrap>,
  )

describe('Sidebar', () => {
  it('renders groups with headings and links', () => {
    sidebar()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getByRole('heading', { level: 2, name: '学校管理' })).toBeInTheDocument()
    expect(within(nav).getAllByRole('heading')).toHaveLength(1)
    expect(within(nav).getByRole('link', { name: '今日关注' })).toHaveAttribute(
      'href',
      '/admin/today',
    )
    expect(within(nav).getByRole('link', { name: '组织架构' })).toBeInTheDocument()
  })

  it('marks the current page', () => {
    sidebar()
    expect(screen.getByRole('link', { name: '组织架构' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '今日关注' })).not.toHaveAttribute('aria-current')
  })

  it('rail hides labels but keeps names', () => {
    sidebar({ collapsed: true })
    expect(screen.getByRole('link', { name: '组织架构' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('nav skeleton keeps slots', () => {
    const { container } = sidebar({ navLoading: true })
    expect(container.querySelectorAll('[data-nav-skeleton]')).toHaveLength(6)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('is a labelled complementary landmark', () => {
    sidebar()
    expect(screen.getByRole('complementary', { name: '侧栏' })).toBeInTheDocument()
  })

  it('marks links, the toggle and the footer slots as touch targets', () => {
    sidebar()
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('touch-target')
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toHaveClass('touch-target')
  })

  it('link className is a plain string and the current page is styled by aria-current', () => {
    sidebar()
    const current = screen.getByRole('link', { name: '组织架构' })
    const cls = current.getAttribute('class') ?? ''
    expect(cls).not.toContain('=>')
    expect(cls).toContain('aria-[current=page]:bg-accent')
    expect(current).toHaveAttribute('aria-current', 'page')
    cleanup()
    sidebar({ collapsed: true })
    expect(screen.getByRole('link', { name: '组织架构' }).getAttribute('class')).not.toContain('=>')
  })

  it('keeps keyboard focus on the toggle when collapsing', () => {
    function Stateful() {
      const [collapsed, setCollapsed] = useState(false)
      return (
        <Sidebar
          groups={GROUPS}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          header={null}
          footer={null}
        />
      )
    }
    render(
      <Wrap>
        <Stateful />
      </Wrap>,
    )
    const toggle = screen.getByRole('button', { name: '折叠侧栏' })
    const link = screen.getByRole('link', { name: '组织架构' })
    toggle.focus()
    fireEvent.click(toggle)
    // 同一个节点,名称变成「展开侧栏」,焦点没有掉到 body
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBe(toggle)
    expect(document.activeElement).toBe(toggle)
    // 链接也没有被卸载重挂
    expect(screen.getByRole('link', { name: '组织架构' })).toBe(link)
  })

  it('drawer variant has no collapse toggle', () => {
    sidebar({ variant: 'drawer' })
    expect(screen.queryByRole('button', { name: '折叠侧栏' })).toBeNull()
  })

  it('toggle button reports state and calls onToggle', () => {
    const onToggle = vi.fn()
    sidebar({ onToggle })
    const btn = screen.getByRole('button', { name: '折叠侧栏' })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

const shell = (
  breadcrumb: ReactNode | null,
  at = '/admin/org',
  scope: 'default' | 'classroom' = 'default',
  drawerBar?: ReactNode,
) =>
  render(
    <Wrap at={at}>
      <SidebarShell
        scope={scope}
        groups={GROUPS}
        header={() => <span>品牌</span>}
        footer={() => <span>脚</span>}
        breadcrumb={breadcrumb}
        drawerBar={drawerBar}
        overlays={<div data-testid="overlay" />}
      >
        <p>内容</p>
      </SidebarShell>
    </Wrap>,
  )

describe('SidebarShell', () => {
  it('shell renders breadcrumb bar unless null', () => {
    const { unmount } = shell(<Breadcrumb items={[{ label: '组织架构' }]} />)
    expect(screen.getByRole('navigation', { name: '面包屑' })).toBeInTheDocument()
    expect(screen.getByTestId('overlay')).toBeInTheDocument()
    unmount()
    shell(null)
    expect(screen.queryByRole('navigation', { name: '面包屑' })).toBeNull()
  })

  it('drawer below 1024', () => {
    mockWidth(800)
    shell(null)
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    // 抽屉靠遮罩、Esc 和抽屉自带的「关闭」收起,不再放折叠按钮
    expect(within(dialog).queryByRole('button', { name: '折叠侧栏' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('exports one drawer breakpoint per scope', () => {
    expect(DRAWER_BREAKPOINT).toEqual({ default: 1024, classroom: 1280 })
  })

  it('classroom scope is a drawer at 1024 and a rail at 1280', () => {
    mockWidth(1024)
    const first = shell(null, '/teacher/classroom', 'classroom')
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
    first.unmount()
    mockWidth(1279)
    const second = shell(null, '/teacher/classroom', 'classroom')
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
    second.unmount()
    mockWidth(1280)
    shell(null, '/teacher/classroom', 'classroom')
    expect(screen.queryByRole('button', { name: '打开菜单' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument()
  })

  it('default scope is a rail at 1024', () => {
    mockWidth(1024)
    shell(null)
    expect(screen.queryByRole('button', { name: '打开菜单' })).toBeNull()
    expect(screen.getByRole('complementary', { name: '侧栏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument()
  })

  it('drawer bar shows drawerBar content next to the menu button when there is no breadcrumb', () => {
    mockWidth(1024)
    shell(null, '/teacher/classroom', 'classroom', <p>三年二班 · 第 10 周</p>)
    expect(screen.getByText('三年二班 · 第 10 周')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
  })

  it('skip link focuses main', () => {
    shell(null)
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '跳到主要内容' }))
    expect(notPrevented).toBe(false)
    expect(document.activeElement?.id).toBe('main')
    expect(window.location.hash).toBe('')
  })

  it('[ toggles the sidebar and persists it', () => {
    shell(null)
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: '[' })
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument()
    expect(localStorage.getItem('ws-sidebar')).toBe('1')
  })

  it('[ is ignored in inputs', () => {
    render(
      <Wrap>
        <SidebarShell
          scope="default"
          groups={GROUPS}
          header={() => null}
          footer={() => null}
          breadcrumb={null}
        >
          <input aria-label="备注" />
        </SidebarShell>
      </Wrap>,
    )
    fireEvent.keyDown(screen.getByLabelText('备注'), { key: '[' })
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toBeInTheDocument()
  })
})

describe('AccountMenu in the sidebar', () => {
  it('account menu opens upward in the sidebar', () => {
    render(
      <Wrap>
        <AccountMenu name="王老师" onLogout={() => {}} placement="top" />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
    expect(screen.getByRole('menu', { name: '账号菜单' })).toHaveClass('bottom-full')
  })

  it('defaults to opening downward', () => {
    render(
      <Wrap>
        <AccountMenu name="王老师" onLogout={() => {}} />
      </Wrap>,
    )
    fireEvent.click(screen.getByRole('button', { name: '账号菜单' }))
    expect(screen.getByRole('menu', { name: '账号菜单' })).toHaveClass('top-full')
  })
})

describe('Breadcrumb', () => {
  it('marks the last crumb as current and links the rest', () => {
    render(
      <Wrap>
        <Breadcrumb
          items={[
            { label: '学校管理' },
            { label: '组织架构', to: '/admin/org' },
            { label: '班级信息' },
          ]}
        />
      </Wrap>,
    )
    const nav = screen.getByRole('navigation', { name: '面包屑' })
    expect(within(nav).getByRole('link', { name: '组织架构' })).toHaveAttribute(
      'href',
      '/admin/org',
    )
    expect(within(nav).getByText('班级信息')).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('link', { name: '学校管理' })).toBeNull()
  })

  it('adminCrumbs: group, page and hidden child', () => {
    expect(adminCrumbs('/admin/today', ADMIN_PAGES).map((c) => c.label)).toEqual(['今日关注'])
    expect(adminCrumbs('/admin/org', ADMIN_PAGES).map((c) => c.label)).toEqual([
      '学校管理',
      '组织架构',
    ])
    const child = adminCrumbs('/admin/org/classes/abc', ADMIN_PAGES)
    expect(child.map((c) => c.label)).toEqual(['学校管理', '组织架构', '班级信息'])
    expect(child[1].to).toBe('/admin/org')
    // 看板里的班级页:没有分组,父级是全校看板
    const klass = adminCrumbs('/admin/classes/abc', ADMIN_PAGES)
    expect(klass.map((c) => c.label)).toEqual(['全校看板', '班级'])
    expect(klass[0].to).toBe('/admin/board')
    // 往年单班与父页同名:只显示父页
    const past = adminCrumbs('/admin/history/classes/abc', ADMIN_PAGES)
    expect(past.map((c) => c.label)).toEqual(['学校管理', '往年班级'])
    expect(adminCrumbs('/admin/nowhere', ADMIN_PAGES)).toEqual([])
  })

  it('teacherCrumbs', () => {
    expect(teacherCrumbs('/teacher/scores').map((c) => c.label)).toEqual(['成绩'])
    expect(teacherCrumbs('/teacher/preferences').map((c) => c.label)).toEqual(['我的偏好'])
    expect(teacherCrumbs('/teacher/nowhere')).toEqual([])
  })
})
