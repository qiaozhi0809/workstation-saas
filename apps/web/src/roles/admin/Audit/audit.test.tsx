import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import type { Account, AuditActions, AuditRow } from '@/shared/types/admin'
import AuditPage from './AuditPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: { audit: vi.fn(), auditActions: vi.fn(), accounts: vi.fn() },
}))

const ACTIONS: AuditActions = {
  groups: [
    {
      key: 'student',
      label: '学生档案',
      actions: [{ action: 'student.update', label: '修改学生档案' }],
    },
    { key: 'grade', label: '成绩与考试', actions: [{ action: 'score.export', label: '导出成绩' }] },
    { key: 'denied', label: '被拒的访问', actions: [] },
  ],
}

const row = (o: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a1',
  at: '2026-11-03T02:30:00Z',
  user_id: 'u1',
  user_name: '李老师',
  action: 'student.update',
  action_label: '修改学生档案',
  object_type: 'student',
  object_id: 's1',
  object_label: '王小明',
  ip: '10.0.0.8',
  success: true,
  extra: null,
  ...o,
})

const account = (o: Partial<Account>): Account => ({
  id: 'u1',
  login_name: 'li',
  display_name: '李老师',
  phone: null,
  employee_no: null,
  subjects: [],
  status: 'active',
  must_change_password: false,
  last_login_at: null,
  roles: [],
  totp_enabled: false,
  ...o,
})

const setup = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuditPage />
    </QueryClientProvider>,
  )
const lastFilters = () => vi.mocked(adminApi.audit).mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0))
  vi.mocked(adminApi.auditActions).mockResolvedValue(ACTIONS)
  vi.mocked(adminApi.audit).mockResolvedValue({ items: [row()], total: 1 })
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [account({})], total: 1 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('审计日志', () => {
  it('默认查最近 7 天(本地日期),从第 1 页开始', async () => {
    setup()
    expect(await screen.findByText('修改学生档案')).toBeInTheDocument()
    expect(lastFilters()).toEqual({ from: '2026-10-29', to: '2026-11-04', page: 1 })
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-10-29')
    expect(screen.getByLabelText('结束日期')).toHaveValue('2026-11-04')
  })

  it('筛选改变时请求参数正确,并且页码回到 1', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({ items: [row()], total: 120 })
    setup()
    await screen.findByText('修改学生档案')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(lastFilters()).toMatchObject({ page: 2 }))

    fireEvent.change(screen.getByLabelText('分组'), { target: { value: 'grade' } })
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-29',
        to: '2026-11-04',
        group: 'grade',
        page: 1,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(lastFilters()).toMatchObject({ group: 'grade', page: 2 }))
    fireEvent.click(screen.getByLabelText('只看被拒'))
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-29',
        to: '2026-11-04',
        group: 'grade',
        success: false,
        page: 1,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(lastFilters()).toMatchObject({ from: '2026-10-01', page: 1 }))
  })

  it('分组下拉来自 auditActions', async () => {
    setup()
    await screen.findByText('修改学生档案')
    const sel = screen.getByLabelText('分组')
    expect(
      within(sel)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['全部分组', '学生档案', '成绩与考试', '被拒的访问'])
  })

  it('搜索操作人后按 user_id 过滤,可清除', async () => {
    setup()
    await screen.findByText('修改学生档案')
    fireEvent.change(screen.getByLabelText('搜索操作人'), { target: { value: '李' } })
    const pick = await screen.findByRole('button', { name: '选择 李老师(li)' }, { timeout: 2000 })
    expect(adminApi.accounts).toHaveBeenLastCalledWith({ q: '李' })
    fireEvent.click(pick)
    await waitFor(() => expect(lastFilters()).toMatchObject({ user_id: 'u1', page: 1 }))
    fireEvent.click(screen.getByRole('button', { name: '清除操作人' }))
    await waitFor(() => expect(lastFilters()?.user_id).toBeUndefined())
  })

  it('被拒的行用红色标记,成功的不标', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({
      items: [
        row({ id: 'ok' }),
        row({ id: 'bad', success: false, action_label: '越权访问', action: 'denied.x' }),
      ],
      total: 2,
    })
    const { container } = setup()
    await screen.findByText('越权访问')
    const failed = container.querySelectorAll('tr[data-failed="true"]')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toHaveTextContent('越权访问')
    expect(failed[0]).toHaveTextContent('被拒')
    expect(container.querySelectorAll('tr[data-failed="false"]')).toHaveLength(1)
  })

  it('展开一行显示 extra 的键值', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({
      items: [row({ extra: { exam_name: '期中考试', count: 3, nested: { a: 1 } } })],
      total: 1,
    })
    setup()
    await screen.findByText('修改学生档案')
    expect(screen.queryByText('exam_name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开 修改学生档案' }))
    expect(screen.getByText('exam_name')).toBeInTheDocument()
    expect(screen.getByText('期中考试')).toBeInTheDocument()
    expect(screen.getByText('count')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('{"a":1}')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起 修改学生档案' }))
    expect(screen.queryByText('exam_name')).toBeNull()
  })

  it('没有 extra 的行不能展开', async () => {
    setup()
    await screen.findByText('修改学生档案')
    expect(screen.queryByRole('button', { name: '展开 修改学生档案' })).toBeNull()
  })

  it('每页 50 条,按 total 分页', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({ items: [row()], total: 120 })
    setup()
    expect(await screen.findByText('共 120 条,第 1 / 3 页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('表头与空状态', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({ items: [], total: 0 })
    setup()
    expect(await screen.findByText('没有符合条件的记录')).toBeInTheDocument()
  })

  it('列出时间、操作人、操作、对象、IP、结果', async () => {
    setup()
    await screen.findByText('修改学生档案')
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['时间', '操作人', '操作', '对象', 'IP', '结果'])
    expect(screen.getByText('李老师')).toBeInTheDocument()
    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.8')).toBeInTheDocument()
  })
})
