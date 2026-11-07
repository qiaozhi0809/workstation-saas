import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm, SetupItem } from '@/shared/types/admin'
import { SetupChecklist } from './SetupChecklist'

// L286:清单走 adminApi.setupChecklist(),类型在 shared/types/admin.ts
vi.mock('@/shared/api/admin', () => ({ adminApi: { setupChecklist: vi.fn() } }))

const ALL_DONE: SetupItem[] = [
  { key: 'school', done: true, detail: '2 个年级都已设学段', to: '/admin/org' },
  { key: 'year', done: true, detail: '当前学年 2026-2027', to: '/admin/upgrade' },
  { key: 'classes', done: true, detail: '已建 3 个班', to: '/admin/org' },
  { key: 'accounts', done: true, detail: '已有 8 个教职工账号', to: '/admin/accounts' },
  { key: 'assignments', done: true, detail: '3 个班都有班主任', to: '/admin/org' },
  { key: 'timetable', done: true, detail: '未启用监控,可跳过', to: '/admin/timetable' },
  { key: 'cameras', done: true, detail: '未启用监控,可跳过', to: '/admin/cameras' },
  { key: 'ai', done: true, detail: '已配置 AI 服务(qwen2.5:7b)', to: '/admin/ai/config' },
]

/** 把若干项改成未完成,并换上后端会给的现状文字 */
const undone = (overrides: Partial<Record<SetupItem['key'], string>>): SetupItem[] =>
  ALL_DONE.map((i) => {
    const detail = overrides[i.key]
    return detail === undefined ? i : { ...i, done: false, detail }
  })

function setPerms(admin_perms: AdminPerm[]) {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u1',
      display_name: '蒋老师',
      contexts: ['admin'],
      admin_perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })
}

function setup(items: SetupItem[]) {
  vi.mocked(adminApi.setupChecklist).mockResolvedValue(items)
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin/today']}>
        <SetupChecklist />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

describe('开学准备清单', () => {
  it('collapses when all done', async () => {
    setPerms(['settings.manage', 'account.manage'])
    setup(ALL_DONE)
    const region = await screen.findByRole('region', { name: '开学准备' })
    expect(await within(region).findByText('开学准备已完成')).toBeInTheDocument()
    // 折叠成一行:逐项与进度都不显示
    expect(within(region).queryByRole('list')).toBeNull()
    expect(within(region).queryByRole('progressbar')).toBeNull()
    const toggle = within(region).getByRole('button', { name: '展开' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(within(region).getByRole('button', { name: '收起' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(region).getAllByRole('listitem')).toHaveLength(8)
    expect(within(region).getByText('已配置 AI 服务(qwen2.5:7b)')).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '收起' }))
    expect(within(region).queryByRole('list')).toBeNull()
  })

  it('links to admin pages', async () => {
    // 教导主任只有 org.manage,也能看到
    setPerms(['school.view', 'org.manage'])
    setup(
      undone({
        school: '2 个年级未设学段',
        assignments: '已建 3 个班,1 个班还没有班主任',
        ai: '不配置也能用,只是没有 AI 助手',
      }),
    )
    const region = await screen.findByRole('region', { name: '开学准备' })
    expect(adminApi.setupChecklist).toHaveBeenCalledTimes(1)
    expect(await within(region).findByText('已完成 5 / 8')).toBeInTheDocument()
    expect(within(region).getByRole('progressbar', { name: '开学准备进度' })).toHaveAttribute(
      'aria-valuenow',
      '63',
    )
    // 未完成项:名字是链接,后面跟着现状
    const link = (name: string) => within(region).getByRole('link', { name })
    expect(link('年级与学段')).toHaveAttribute('href', '/admin/org')
    expect(within(region).getByText('2 个年级未设学段')).toBeInTheDocument()
    expect(link('班主任')).toHaveAttribute('href', '/admin/org')
    expect(within(region).getByText('已建 3 个班,1 个班还没有班主任')).toBeInTheDocument()
    expect(link('AI 服务')).toHaveAttribute('href', '/admin/ai/config')
    expect(within(region).getByText('不配置也能用,只是没有 AI 助手')).toBeInTheDocument()
    // 已完成项也列出并可跳转
    expect(link('当前学年')).toHaveAttribute('href', '/admin/upgrade')
    expect(link('教职工账号')).toHaveAttribute('href', '/admin/accounts')
    expect(link('课表')).toHaveAttribute('href', '/admin/timetable')
    expect(link('摄像头')).toHaveAttribute('href', '/admin/cameras')
    expect(within(region).getAllByText('已完成')).toHaveLength(5)
    expect(within(region).getAllByText('未完成')).toHaveLength(3)
    // 没全部完成时不折叠
    expect(within(region).queryByRole('button', { name: /展开|收起/ })).toBeNull()
  })

  it('hidden for grade head', async () => {
    setPerms(['school.view', 'notice.send', 'exam.grade_write', 'camera.view'])
    const { container } = setup(ALL_DONE)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(adminApi.setupChecklist).not.toHaveBeenCalled()
  })

  it('keeps the card in place while loading', () => {
    setPerms(['settings.manage'])
    vi.mocked(adminApi.setupChecklist).mockReturnValue(new Promise(() => {}))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SetupChecklist />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const region = screen.getByRole('region', { name: '开学准备' })
    expect(within(region).getByRole('status')).toHaveTextContent('开学准备清单加载中…')
    expect(within(region).queryByRole('list')).toBeNull()
  })

  it('shows a retry when the checklist fails to load', async () => {
    setPerms(['settings.manage'])
    vi.mocked(adminApi.setupChecklist).mockRejectedValueOnce(new Error('net'))
    setup(ALL_DONE)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('开学准备清单加载失败')
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('开学准备已完成')).toBeInTheDocument()
  })
})
