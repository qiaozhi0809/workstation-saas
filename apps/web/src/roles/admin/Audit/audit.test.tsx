import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { schoolApi } from '@/shared/api/school'
import type { Account, AuditActions, AuditRow } from '@/shared/types/admin'
import type { Meta } from '@/shared/types/school'
import AuditPage from './AuditPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: { audit: vi.fn(), auditActions: vi.fn(), accounts: vi.fn() },
}))
vi.mock('@/shared/api/school', () => ({ schoolApi: { meta: vi.fn() } }))

const META: Meta = { version: '1.0.0', school_name: '示例小学', school_tz: 'Asia/Shanghai' }

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
  // 2026-11-04 16:30 UTC:学校(上海)已经是 11-05 00:30,UTC−12 … UTC+7 的浏览器还在 11-04
  vi.setSystemTime(new Date('2026-11-04T16:30:00Z'))
  vi.mocked(schoolApi.meta).mockResolvedValue(META)
  vi.mocked(adminApi.auditActions).mockResolvedValue(ACTIONS)
  vi.mocked(adminApi.audit).mockResolvedValue({ items: [row()], total: 1 })
  vi.mocked(adminApi.accounts).mockResolvedValue({ items: [account({})], total: 1 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('审计日志', () => {
  it('默认查最近 7 天,结束日是学校时区里的今天(L43),从第 1 页开始', async () => {
    setup()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(lastFilters()).toEqual({ from: '2026-10-30', to: '2026-11-05', page: 1 })
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-10-30')
    expect(screen.getByLabelText('结束日期')).toHaveValue('2026-11-05')
    // 只请求过一次:不是先按浏览器日期查一遍再改
    expect(adminApi.audit).toHaveBeenCalledTimes(1)
  })

  it('取不到学校时区时退回浏览器日期,页面照常可用', async () => {
    vi.mocked(schoolApi.meta).mockRejectedValue(new Error('offline'))
    setup()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    const local = new Date().toLocaleDateString('sv-SE')
    expect(lastFilters()).toMatchObject({ to: local, page: 1 })
  })

  it('筛选改变时请求参数正确,并且页码回到 1', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({ items: [row()], total: 120 })
    setup()
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(lastFilters()).toMatchObject({ page: 2 }))

    fireEvent.change(screen.getByLabelText('分组'), { target: { value: 'grade' } })
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
        group: 'grade',
        page: 1,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(lastFilters()).toMatchObject({ group: 'grade', page: 2 }))
    fireEvent.click(screen.getByLabelText('只看被拒'))
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
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
    await screen.findByRole('table')
    const sel = screen.getByLabelText('分组')
    expect(
      within(sel)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['全部分组', '学生档案', '成绩与考试', '被拒的访问'])
  })

  it('搜索操作人后按 user_id 过滤,可清除', async () => {
    setup()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('搜索操作人'), { target: { value: '李' } })
    const pick = await screen.findByRole('button', { name: '选择 李老师(li)' }, { timeout: 2000 })
    expect(adminApi.accounts).toHaveBeenLastCalledWith({ q: '李', page: 1 })
    fireEvent.click(pick)
    await waitFor(() => expect(lastFilters()).toMatchObject({ user_id: 'u1', page: 1 }))
    fireEvent.click(screen.getByRole('button', { name: '清除操作人' }))
    await waitFor(() => expect(lastFilters()?.user_id).toBeUndefined())
  })

  it('操作人下拉在焦点移出时关闭,回到输入框再打开(L59)', async () => {
    setup()
    await screen.findByRole('table')
    const input = screen.getByLabelText('搜索操作人')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '李' } })
    await screen.findByRole('button', { name: '选择 李老师(li)' }, { timeout: 2000 })
    fireEvent.blur(input, { relatedTarget: screen.getByLabelText('分组') })
    expect(screen.queryByRole('button', { name: '选择 李老师(li)' })).toBeNull()
    // 输入的字还在;再聚焦就重新展开,不用重新输入
    expect(input).toHaveValue('李')
    fireEvent.focus(input)
    expect(screen.getByRole('button', { name: '选择 李老师(li)' })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '选择 李老师(li)' })).toBeNull()
    // 点到页面上不可聚焦的地方(relatedTarget 为空)也收起
    fireEvent.focus(input)
    expect(screen.getByRole('button', { name: '选择 李老师(li)' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: '选择 李老师(li)' })).toBeNull()
  })

  it('操作人下拉在 relatedTarget 为空的失焦时不关闭,否则 Safari/Firefox 点不中选项(L59)', async () => {
    setup()
    await screen.findByRole('table')
    const input = screen.getByLabelText('搜索操作人')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '李' } })
    const option = await screen.findByRole('button', { name: '选择 李老师(li)' }, { timeout: 2000 })
    // Safari/Firefox 点按钮不会把焦点给按钮,blur 的 relatedTarget 为 null;此时不能收起,
    // 否则 click 永远落不到选项上。点到组件外由 pointerdown 监听负责收起。
    fireEvent.blur(input, { relatedTarget: null })
    expect(option).toBeInTheDocument()
    fireEvent.click(option)
    await waitFor(() => expect(lastFilters()?.user_id).toBe('u1'))
  })

  it('操作人搜索结果超过一页时能加载更多,不只首页(L59)', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) =>
      account({ id: `u${i}`, login_name: `li${i}`, display_name: `李老师${i}` }),
    )
    vi.mocked(adminApi.accounts).mockImplementation(async (f = {}) =>
      f.page === 2
        ? {
            items: [account({ id: 'u99', login_name: 'li99', display_name: '李老师99' })],
            total: 51,
          }
        : { items: firstPage, total: 51 },
    )
    setup()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('搜索操作人'), { target: { value: '李' } })
    const more = await screen.findByRole('button', { name: /加载更多/ }, { timeout: 2000 })
    expect(more).toHaveTextContent('还有 1 个')
    expect(screen.queryByRole('button', { name: '选择 李老师99(li99)' })).toBeNull()
    fireEvent.click(more)
    expect(await screen.findByRole('button', { name: '选择 李老师99(li99)' })).toBeInTheDocument()
    expect(adminApi.accounts).toHaveBeenLastCalledWith({ q: '李', page: 2 })
    expect(screen.getByRole('button', { name: '选择 李老师0(li0)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /加载更多/ })).toBeNull()
  })

  it('可按具体操作与对象类型筛选;选了分组后操作下拉只剩该组的动作(L59)', async () => {
    setup()
    await screen.findByRole('table')
    const options = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole('option')
        .map((o) => o.textContent)
    expect(options('操作')).toEqual(['全部操作', '修改学生档案', '导出成绩'])
    fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'score.export' } })
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
        action: 'score.export',
        page: 1,
      }),
    )
    // 选分组:操作下拉只剩该组的动作,原来选的不在组里就清掉
    fireEvent.change(screen.getByLabelText('分组'), { target: { value: 'student' } })
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
        group: 'student',
        page: 1,
      }),
    )
    expect(options('操作')).toEqual(['全部操作', '修改学生档案'])
    expect(screen.getByLabelText('操作')).toHaveValue('')
    // 对象类型用中文名,发的是后端的 object_type
    expect(options('对象类型')).toContain('通知')
    fireEvent.change(screen.getByLabelText('对象类型'), { target: { value: 'notice' } })
    await waitFor(() =>
      expect(lastFilters()).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
        group: 'student',
        object_type: 'notice',
        page: 1,
      }),
    )
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
    await screen.findByRole('table')
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
    await screen.findByRole('table')
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

  it('对象列:没有对象名时显示动作中文名而不是 UUID,连对象 id 都没有时显示破折号(L58)', async () => {
    vi.mocked(adminApi.audit).mockResolvedValue({
      items: [
        row({ id: 'named' }),
        row({
          id: 'unnamed',
          user_name: '王老师',
          action: 'notice.send',
          action_label: '发送通知',
          object_type: 'notice',
          object_id: '7c1e4b1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b',
          object_label: null,
        }),
        row({
          id: 'none',
          user_name: '赵老师',
          object_type: null,
          object_id: null,
          object_label: null,
        }),
      ],
      total: 3,
    })
    setup()
    await screen.findByText('王小明')
    const objectCell = (operator: string) =>
      within(screen.getByText(operator).closest('tr') as HTMLElement).getAllByRole('cell')[3]
    expect(objectCell('李老师')).toHaveTextContent('王小明')
    expect(objectCell('王老师')).toHaveTextContent('发送通知')
    expect(screen.queryByText('7c1e4b1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b')).toBeNull()
    expect(objectCell('赵老师')).toHaveTextContent('—')
  })

  // L270:时间列按学校时区显示(与筛选区间同口径;登录日志页已如此),不按浏览器时区
  it('time column in school tz', async () => {
    setup()
    await screen.findByRole('table')
    const timeCell = within(screen.getByText('李老师').closest('tr') as HTMLElement).getAllByRole(
      'cell',
    )[0]
    // 02:30 UTC 在上海是 10:30;若按浏览器(CI 为 UTC)时区就会显示 02:30
    expect(timeCell).toHaveTextContent('2026-11-03 10:30')
  })

  it('列出时间、操作人、操作、对象、IP、结果', async () => {
    setup()
    await screen.findByRole('table')
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['时间', '操作人', '操作', '对象', 'IP', '结果'])
    expect(screen.getByText('李老师')).toBeInTheDocument()
    expect(screen.getByText('王小明')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.8')).toBeInTheDocument()
  })
})
