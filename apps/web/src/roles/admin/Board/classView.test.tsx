import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import ClassViewPage from './ClassViewPage'
import { boardClass, boardView } from './boardFixtures'

vi.mock('@/shared/api/admin', () => ({ adminApi: { board: vi.fn() } }))
vi.mock('@/roles/teacher/StudentProfile/StudentProfileDrawer', () => ({
  default: ({ studentId }: { studentId: string }) => <div role="dialog" aria-label="学生档案">档案 {studentId}</div>,
}))

function Url() {
  const l = useLocation()
  return <div data-testid="url">{l.pathname + l.search}</div>
}

function setup(entry = '/admin/classes/c1?grade=g3') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/classes/:id" element={<><ClassViewPage /><Url /></>} />
          <Route path="/admin/board" element={<div>看板页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.board).mockImplementation(async (g) =>
    g === 'g4' ? boardView({ grade_id: 'g4', classes: [boardClass({ id: 'c9', name: '四年一班', room: '401' })] }) : boardView())
})
afterEach(cleanup)

describe('单班只读页', () => {
  it('显示班名、教室、班主任与今日考勤汇总', async () => {
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: '三年一班 · 301 · 班主任 赵老师' })).toBeInTheDocument()
    const sum = screen.getByRole('region', { name: '今日考勤' })
    expect(within(sum).getByText('出勤 2/3')).toBeInTheDocument()
    expect(within(sum).getByRole('button', { name: /李小二/ })).toHaveTextContent('缺勤')
    expect(within(sum).getByRole('button', { name: /张小三/ })).toHaveTextContent('迟到')
  })

  it('座位带考勤小牌,点座位打开档案抽屉', async () => {
    setup()
    const seat = await screen.findByRole('button', { name: /李小二，第1排第2列，缺/ })
    fireEvent.click(seat)
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('student=s2'))
    expect(screen.getByRole('dialog', { name: '学生档案' })).toHaveTextContent('s2')
  })

  it('没有任何写入口', async () => {
    setup()
    await screen.findByRole('heading', { level: 1 })
    for (const re of [/考勤/, /点评/, /排座/, /保存/, /编辑/, /确认/, /删除/]) {
      expect(screen.queryByRole('button', { name: re })).toBeNull()
    }
  })

  it('返回全校看板', async () => {
    setup()
    fireEvent.click(await screen.findByRole('link', { name: '← 全校看板' }))
    expect(await screen.findByText('看板页')).toBeInTheDocument()
  })

  it('没带年级参数时在其他年级里找班', async () => {
    setup('/admin/classes/c9')
    expect(await screen.findByRole('heading', { level: 1, name: '四年一班 · 401 · 班主任 赵老师' })).toBeInTheDocument()
  })

  it('找不到班级', async () => {
    setup('/admin/classes/nope?grade=g3')
    expect(await screen.findByText('未找到该班级')).toBeInTheDocument()
  })
})
