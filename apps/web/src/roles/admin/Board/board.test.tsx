import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import BoardPage from './BoardPage'
import { boardClass, boardView } from './boardFixtures'

vi.mock('@/shared/api/admin', () => ({ adminApi: { board: vi.fn() } }))

function Loc() {
  const l = useLocation()
  return <div data-testid="loc">{l.pathname + l.search}</div>
}

function setup() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
    g === 'g4' ? boardView({ grade_id: 'g4', classes: [boardClass({ id: 'c9', name: '四年一班' })] }) : boardView())
})
afterEach(cleanup)

describe('全校看板', () => {
  it('切换年级页签请求带 grade_id', async () => {
    setup()
    expect(await screen.findByText('三年一班')).toBeInTheDocument()
    expect(adminApi.board).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('tab', { name: '四年级' }))
    expect(await screen.findByText('四年一班')).toBeInTheDocument()
    expect(adminApi.board).toHaveBeenLastCalledWith('g4')
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
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/admin/classes/c2?grade=g3'))
  })

  it('网格随宽度 1 / 2 / 3 / 4 列', async () => {
    setup()
    const grid = (await screen.findByText('三年一班')).closest('[data-class-grid]') as HTMLElement
    for (const c of ['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4']) expect(grid).toHaveClass(c)
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
