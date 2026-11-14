import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Building2, Sun } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu'
import { Sidebar, type SidebarGroup } from './Sidebar'
import SidebarShell from './SidebarShell'
import { Breadcrumb, adminCrumbs, teacherCrumbs } from './Breadcrumb'
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

const Wrap = ({ children, at = '/admin/org' }: { children: ReactNode; at?: string }) => (
  <MemoryRouter initialEntries={[at]}>{children}</MemoryRouter>
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
    expect(screen.getByRole('link', { name: '组织架构' })).toHaveAttribute(
      'aria-current',
      'page',
    )
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

  it('toggle button reports state and calls onToggle', () => {
    const onToggle = vi.fn()
    sidebar({ onToggle })
    const btn = screen.getByRole('button', { name: '折叠侧栏' })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

const shell = (breadcrumb: ReactNode | null, at = '/admin/org') =>
  render(
    <Wrap at={at}>
      <SidebarShell
        scope="default"
        groups={GROUPS}
        header={() => <span>品牌</span>}
        footer={() => <span>脚</span>}
        breadcrumb={breadcrumb}
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
    expect(adminCrumbs('/admin/nowhere', ADMIN_PAGES)).toEqual([])
  })

  it('teacherCrumbs', () => {
    expect(teacherCrumbs('/teacher/scores').map((c) => c.label)).toEqual(['成绩'])
    expect(teacherCrumbs('/teacher/preferences').map((c) => c.label)).toEqual(['我的偏好'])
    expect(teacherCrumbs('/teacher/nowhere')).toEqual([])
  })
})
