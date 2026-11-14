import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { camerasApi } from '@/shared/api/cameras'
import { useAuthStore } from '@/shared/stores/auth'
import BoardPage from './BoardPage'
import { boardClass, boardView } from './boardFixtures'

vi.mock('@/shared/api/admin', () => ({ adminApi: { board: vi.fn() } }))
vi.mock('@/shared/api/cameras', () => ({ camerasApi: { wall: vi.fn() } }))

function Loc() {
  const l = useLocation()
  return <div data-testid="loc">{l.pathname + l.search}</div>
}

function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin/board']}>
        <Routes>
          <Route path="/admin/board" element={<BoardPage />} />
          <Route path="/admin/classes/:id" element={<Loc />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.board).mockImplementation(async (g) =>
    g === 'g4'
      ? boardView({ grade_id: 'g4', classes: [boardClass({ id: 'c9', name: '四年一班' })] })
      : boardView(),
  )
  vi.mocked(camerasApi.wall).mockResolvedValue({
    school_name: '示例小学',
    timezone: 'Asia/Shanghai',
    grades: [],
    public: [],
  })
})
afterEach(() => {
  cleanup()
  useAuthStore.setState({ user: null })
})

describe('全校看板', () => {
  it('切换年级页签请求带 grade_id', async () => {
    setup()
    expect(await screen.findByText('三年一班')).toBeInTheDocument()
    expect(adminApi.board).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('tab', { name: '四年级' }))
    expect(await screen.findByText('四年一班')).toBeInTheDocument()
    expect(adminApi.board).toHaveBeenLastCalledWith('g4')
  })

  it('地址带 ?grade= 时按该年级打开', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/admin/board?grade=g4']}>
          <BoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('四年一班')).toBeInTheDocument()
    expect(adminApi.board).toHaveBeenCalledWith('g4')
    expect(screen.getByRole('tab', { name: '四年级' })).toHaveAttribute('aria-selected', 'true')
  })

  it('卡片显示班名、教室、班主任与指标', async () => {
    setup()
    const card = (await screen.findByText('三年一班')).closest('[data-class-card]') as HTMLElement
    expect(within(card).getByText(/301/)).toBeInTheDocument()
    expect(within(card).getByText(/班主任 赵老师/)).toBeInTheDocument()
    expect(within(card).getByText('出勤 2/3 · 缺勤 1 · 本周点评 +5')).toBeInTheDocument()
    expect(within(card).queryByText('未确认考勤')).toBeNull()
    const other = screen.getByText('三年二班').closest('[data-class-card]') as HTMLElement
    expect(within(other).getByText('未确认考勤')).toBeInTheDocument()
    expect(within(other).getByText('出勤 1/1 · 缺勤 0 · 本周点评 -2')).toBeInTheDocument()
  })

  it('缺勤与迟到学生座位带文字小牌', async () => {
    setup()
    const card = (await screen.findByText('三年一班')).closest('[data-class-card]') as HTMLElement
    expect(card.querySelector('[data-enrollment="e2"]')).toHaveTextContent('缺')
    expect(card.querySelector('[data-enrollment="e3"]')).toHaveTextContent('迟')
    expect(card.querySelector('[data-enrollment="e1"]')).not.toHaveTextContent(/缺|迟|假/)
  })

  it('点卡片跳到单班页', async () => {
    setup()
    fireEvent.click(await screen.findByRole('link', { name: /三年二班/ }))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/classes/c2'))
  })

  it('网格按最小卡宽自适应列数', async () => {
    setup()
    const grid = (await screen.findByText('三年一班')).closest('[data-class-grid]') as HTMLElement
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]')
    expect(grid.className).not.toMatch(/(^|\s)(md|lg|xl|2xl):grid-cols-\d/)
  })

  it('班级卡是 Card;教室与班主任各占一行,班主任不截断', async () => {
    setup()
    const card = (await screen.findByText('三年一班')).closest('[data-class-card]') as HTMLElement
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(within(card).getByText('教室 301')).toBeInTheDocument()
    const teacher = within(card).getByText('班主任 赵老师')
    expect(teacher).toHaveAttribute('data-homeroom')
    expect(teacher.className).not.toContain('truncate')
    // 没有班主任的班不渲染这一行
    const other = screen.getByText('三年二班').closest('[data-class-card]') as HTMLElement
    expect(other.querySelector('[data-homeroom]')).toBeNull()
  })

  it('年级切换放在页头操作区', async () => {
    setup()
    await screen.findByText('三年一班')
    const header = screen.getByRole('heading', { level: 1, name: '全校看板' }).closest('header')!
    expect(within(header as HTMLElement).getByRole('tab', { name: '三年级' })).toBeInTheDocument()
  })

  // L216:带监控侧栏时(≥ 1024)侧栏随滚动固定在 #main 顶部、不高于主区域(视口减 3.5rem 顶栏)并自己滚动;
  // 卡片在 1024 宽保持两列,xl 才三列(没有侧栏时 lg 就是三列,见上一条)
  it('sidebar is sticky', async () => {
    useAuthStore.setState({ user: { admin_perms: ['camera.view'] } as never })
    setup()
    await screen.findByText('三年一班')
    const side = screen.getByTestId('camera-wall').parentElement as HTMLElement
    // 1280 宽侧栏壳占掉 264,监控放右侧会把班级卡挤成一列:2xl 才并排,更窄时落在班级卡下面
    expect(side).toHaveClass(
      '2xl:sticky',
      '2xl:top-6',
      '2xl:max-h-[calc(100dvh-1.5rem)]',
      '2xl:overflow-auto',
      '2xl:w-96',
    )
    expect(side).not.toHaveClass('lg:sticky')
    const grid = screen.getByText('三年一班').closest('[data-class-grid]') as HTMLElement
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]')
  })

  it('页面没有缩放按钮', async () => {
    setup()
    await screen.findByText('三年一班')
    expect(screen.queryByRole('button', { name: /放大|缩小|适应/ })).toBeNull()
  })

  it('加载失败可重试', async () => {
    vi.mocked(adminApi.board).mockRejectedValueOnce(new Error('x'))
    setup()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('三年一班')).toBeInTheDocument()
  })
})
