import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import ClassViewPage from './ClassViewPage'
import { boardClassApi } from './api'
import { boardClass } from './boardFixtures'

vi.mock('./api', () => ({ boardClassApi: { detail: vi.fn() } }))
vi.mock('@/roles/teacher/StudentProfile/StudentProfileDrawer', () => ({
  default: ({ studentId }: { studentId: string }) => <div role="dialog" aria-label="学生档案">档案 {studentId}</div>,
}))

function Url() {
  const l = useLocation()
  return <div data-testid="url">{l.pathname + l.search}</div>
}

function setup(entry = '/admin/classes/c1') {
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
  vi.mocked(boardClassApi.detail).mockImplementation(async (id) => {
    if (id === 'nope') throw new ApiError(404, 'NOT_FOUND', '班级不存在')
    return { ...boardClass({ id }), absentees: [{ student_id: 's2', name: '李小二', status: 'absent', reason: '感冒' }] }
  })
})
afterEach(cleanup)

describe('单班只读页', () => {
  it('显示班名、教室、班主任与今日考勤汇总', async () => {
    setup()
    expect(await screen.findByRole('heading', { level: 1, name: '三年一班 · 301 · 班主任 赵老师' })).toBeInTheDocument()
    const sum = screen.getByRole('region', { name: '今日考勤' })
    expect(within(sum).getByText('出勤 2/3')).toBeInTheDocument()
    expect(within(sum).getByRole('button', { name: /李小二/ })).toHaveTextContent('缺勤')
    expect(within(sum).getByRole('button', { name: /李小二/ })).toHaveTextContent('感冒')
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

  it('座位上拖动不产生拖拽影子,也没有空座位处理', async () => {
    const { container } = setup()
    const seat = await screen.findByRole('button', { name: /王小一/ })
    fireEvent.pointerDown(seat, { clientX: 10, clientY: 10, button: 0, pointerId: 1 })
    fireEvent.pointerMove(seat, { clientX: 120, clientY: 120, pointerId: 1 })
    expect(container.querySelector('.cr-drag-ghost')).toBeNull()
    expect(screen.queryByRole('button', { name: /空座/ })).toBeNull()
  })

  it('返回全校看板', async () => {
    setup()
    const link = await screen.findByRole('link', { name: '← 全校看板' })
    expect(link).toHaveAttribute('href', '/admin/board')
    fireEvent.click(link)
    expect(await screen.findByText('看板页')).toBeInTheDocument()
  })

  it('按班级 id 请求新端点', async () => {
    setup()
    await screen.findByRole('heading', { level: 1 })
    expect(boardClassApi.detail).toHaveBeenCalledWith('c1')
  })

  it('找不到班级', async () => {
    setup('/admin/classes/nope')
    expect(await screen.findByText('未找到该班级')).toBeInTheDocument()
  })
})
