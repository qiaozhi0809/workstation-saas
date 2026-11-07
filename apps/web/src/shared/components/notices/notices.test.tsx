import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/client'
import { noticesApi } from '@/shared/api/notices'
import type { AckRow, AckSpec, AckStats, InboxItem } from '@/shared/types/admin'
import AckForm from './AckForm'
import AckSettings from './AckSettings'
import AckStatsDialog from './AckStatsDialog'

vi.mock('@/shared/api/notices', () => ({
  noticesApi: { ack: vi.fn(), acks: vi.fn(), exportAcks: vi.fn() },
}))

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const FUTURE = '2099-12-31T10:00:00Z'
const PAST = '2000-01-01T10:00:00Z'

// ---------- AckSettings ----------
function Harness({
  initial = { kind: 'none' } as AckSpec,
  onDeadline = vi.fn(),
  initialDeadline = null as string | null,
}) {
  const [v, setV] = useState<AckSpec>(initial)
  const [d, setD] = useState<string | null>(initialDeadline)
  return (
    <AckSettings
      value={v}
      onChange={setV}
      deadline={d}
      onDeadlineChange={(x) => {
        setD(x)
        onDeadline(x)
      }}
    />
  )
}
const typeOpt = (n: number, text: string) =>
  fireEvent.change(screen.getByLabelText(`选项 ${n}`), { target: { value: text } })

describe('AckSettings', () => {
  it('三种回执方式,默认不要回执且不显示截止与选项', () => {
    render(<Harness />)
    expect(screen.getByRole('radio', { name: '不要回执' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '已知晓' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '单选' })).not.toBeChecked()
    expect(screen.queryByLabelText('截止时间')).toBeNull()
    expect(screen.queryByLabelText('选项 1')).toBeNull()
  })

  it('选已知晓:显示截止时间,不显示选项', () => {
    const onChange = vi.fn()
    render(<AckSettings value={{ kind: 'none' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '已知晓' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'confirm' })
    cleanup()
    render(<AckSettings value={{ kind: 'confirm' }} onChange={onChange} />)
    expect(screen.getByLabelText('截止时间')).toBeInTheDocument()
    expect(screen.queryByLabelText('选项 1')).toBeNull()
  })

  it('选单选:出现两个空选项与允许留言', () => {
    const onChange = vi.fn()
    render(<AckSettings value={{ kind: 'none' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: '单选' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'choice', options: ['', ''], allow_note: false })
    cleanup()
    render(<Harness initial={{ kind: 'choice', options: ['', ''], allow_note: false }} />)
    expect(screen.getByLabelText('选项 1')).toHaveAttribute('maxlength', '20')
    expect(screen.getByLabelText('选项 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '允许留言' }))
    expect(screen.getByRole('checkbox', { name: '允许留言' })).toBeChecked()
  })

  it('选项可增删,2 到 5 个', () => {
    render(<Harness initial={{ kind: 'choice', options: ['去', '不去'], allow_note: false }} />)
    const add = screen.getByRole('button', { name: '添加选项' })
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.click(add)
    expect(screen.getByLabelText('选项 5')).toBeInTheDocument()
    expect(screen.queryByLabelText('选项 6')).toBeNull()
    expect(screen.getByRole('button', { name: '添加选项' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除选项 5' }))
    expect(screen.queryByLabelText('选项 5')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '删除选项 4' }))
    fireEvent.click(screen.getByRole('button', { name: '删除选项 3' }))
    expect(screen.queryByRole('button', { name: /删除选项/ })).toBeNull() // 只剩 2 个不能再删
    expect(screen.getByLabelText('选项 2')).toBeInTheDocument()
  })

  it('选项少于 2 个有效值时报错;重复时报错;合规时无错误', () => {
    render(<Harness initial={{ kind: 'choice', options: ['', ''], allow_note: false }} />)
    expect(screen.getByText('至少要 2 个选项')).toBeInTheDocument()
    typeOpt(1, '去')
    expect(screen.getByText('至少要 2 个选项')).toBeInTheDocument()
    typeOpt(2, ' 去 ')
    expect(screen.queryByText('至少要 2 个选项')).toBeNull()
    expect(screen.getByText('选项不能重复')).toBeInTheDocument()
    typeOpt(2, '不去')
    expect(screen.queryByText('选项不能重复')).toBeNull()
    expect(screen.queryByText('至少要 2 个选项')).toBeNull()
  })

  it('刚添加、还没动过的空选项不立刻报"选项不能为空";动过后清空或夹在中间才报,文案与 ackSpecError 一致(L89)', () => {
    render(<Harness initial={{ kind: 'choice', options: ['去', '不去'], allow_note: false }} />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    expect(screen.getByLabelText('选项 3')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    typeOpt(3, '待定')
    expect(screen.queryByRole('alert')).toBeNull()
    typeOpt(3, '')
    expect(screen.getByText('选项不能为空')).toBeInTheDocument()
    typeOpt(3, '待定')
    // 再添两个空的,只填后一个:前一个空的夹在中间,要报
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    expect(screen.queryByRole('alert')).toBeNull()
    typeOpt(5, '再议')
    expect(screen.getByText('选项不能为空')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除选项 4' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('"没动过"按选项记而不按位置:删掉后面填过的选项,前面没动过的空选项回到末尾就不再报(L281)', () => {
    render(<Harness initial={{ kind: 'choice', options: ['去', '不去'], allow_note: false }} />)
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    typeOpt(4, '再议')
    expect(screen.getByText('选项不能为空')).toBeInTheDocument() // 选项 3 夹在中间
    fireEvent.click(screen.getByRole('button', { name: '删除选项 4' }))
    expect(screen.getByLabelText('选项 3')).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull() // 选项 3 又成了末尾没动过的空行
    typeOpt(3, '待定')
    expect(screen.queryByRole('alert')).toBeNull()
    typeOpt(3, '')
    expect(screen.getByText('选项不能为空')).toBeInTheDocument() // 动过后清空就照报
  })

  it('截止时间早于现在报错,晚于现在无错;清空回 null', () => {
    const onDeadline = vi.fn()
    render(<Harness initial={{ kind: 'confirm' }} onDeadline={onDeadline} />)
    const input = screen.getByLabelText('截止时间')
    fireEvent.change(input, { target: { value: '2000-01-01T10:00' } })
    expect(screen.getByText('截止时间要晚于现在')).toBeInTheDocument()
    expect(onDeadline).toHaveBeenLastCalledWith(new Date('2000-01-01T10:00').toISOString())
    fireEvent.change(input, { target: { value: '2099-01-01T10:00' } })
    expect(screen.queryByText('截止时间要晚于现在')).toBeNull()
    expect(onDeadline).toHaveBeenLastCalledWith(new Date('2099-01-01T10:00').toISOString())
    fireEvent.change(input, { target: { value: '' } })
    expect(onDeadline).toHaveBeenLastCalledWith(null)
  })

  it('已有的过去截止时间也提示错误', () => {
    render(<Harness initial={{ kind: 'confirm' }} initialDeadline={PAST} />)
    expect(screen.getByText('截止时间要晚于现在')).toBeInTheDocument()
  })

  it('选项输入把值回传给 onChange', () => {
    const onChange = vi.fn()
    render(
      <AckSettings
        value={{ kind: 'choice', options: ['', ''], allow_note: false }}
        onChange={onChange}
      />,
    )
    typeOpt(1, '去')
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'choice',
      options: ['去', ''],
      allow_note: false,
    })
  })
})

// ---------- AckForm ----------
const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'n1',
  title: '家长会',
  content: '周五晚',
  from_name: '王老师',
  created_at: '2026-11-04T01:00:00Z',
  read_at: null,
  recalled: false,
  ack: { kind: 'confirm' },
  ack_deadline: null,
  my_ack: null,
  students: [],
  students_detail: [],
  can_ack: true,
  ack_block_reason: null,
  ...over,
})
const choiceAck: AckSpec = { kind: 'choice', options: ['参加', '不参加'], allow_note: true }
const renderForm = (it: InboxItem, onSubmitted?: () => void) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const spy = vi.spyOn(qc, 'invalidateQueries')
  render(
    <QueryClientProvider client={qc}>
      <AckForm item={it} onSubmitted={onSubmitted} />
    </QueryClientProvider>,
  )
  return spy
}

describe('AckForm', () => {
  it('不要回执时不渲染', () => {
    renderForm(item({ ack: { kind: 'none' }, can_ack: false }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/已撤回|已截止|已回执/)).toBeNull()
  })

  it('confirm:点"已知晓"提交 {choice:null,note:null},刷新收件箱并回调', async () => {
    vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
    const onSubmitted = vi.fn()
    const spy = renderForm(item(), onSubmitted)
    fireEvent.click(screen.getByRole('button', { name: '已知晓' }))
    await waitFor(() =>
      expect(noticesApi.ack).toHaveBeenCalledWith('n1', { choice: null, note: null }),
    )
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notices', 'inbox'] })
    expect(await screen.findByText(/^已回执:已知晓,/)).toBeInTheDocument()
  })

  it('choice:未选时不能提交;选项+留言提交', async () => {
    vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
    renderForm(item({ ack: choiceAck }))
    const submit = screen.getByRole('button', { name: '提交回执' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: '不参加' }))
    fireEvent.change(screen.getByLabelText('留言'), { target: { value: '  有事  ' } })
    expect(screen.getByText('6 / 200')).toBeInTheDocument()
    fireEvent.click(submit)
    await waitFor(() =>
      expect(noticesApi.ack).toHaveBeenCalledWith('n1', { choice: 1, note: '有事' }),
    )
  })

  it('choice 不允许留言时没有留言框,note 为 null', async () => {
    vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
    renderForm(item({ ack: { kind: 'choice', options: ['A', 'B'], allow_note: false } }))
    expect(screen.queryByLabelText('留言')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: '提交回执' }))
    await waitFor(() =>
      expect(noticesApi.ack).toHaveBeenCalledWith('n1', { choice: 0, note: null }),
    )
  })

  it('留言框最多 200 字', () => {
    renderForm(item({ ack: choiceAck }))
    expect(screen.getByLabelText('留言')).toHaveAttribute('maxlength', '200')
  })

  it('已回执:显示选项与时间和"修改",点修改可改选并重新提交', async () => {
    vi.mocked(noticesApi.ack).mockResolvedValue(undefined)
    renderForm(
      item({
        ack: choiceAck,
        my_ack: { choice: 0, note: '会到', acked_at: '2026-11-04T03:00:00Z' },
      }),
    )
    expect(screen.getByText(/^已回执:参加,\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交回执' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    expect(screen.getByRole('radio', { name: '参加' })).toBeChecked()
    expect(screen.getByLabelText('留言')).toHaveValue('会到')
    fireEvent.click(screen.getByRole('radio', { name: '不参加' }))
    fireEvent.click(screen.getByRole('button', { name: '提交回执' }))
    await waitFor(() =>
      expect(noticesApi.ack).toHaveBeenCalledWith('n1', { choice: 1, note: '会到' }),
    )
    expect(await screen.findByText(/^已回执:不参加,/)).toBeInTheDocument()
  })

  it('confirm 点修改后有取消,取消回到已回执视图且不提交', () => {
    renderForm(item({ my_ack: { choice: null, note: null, acked_at: '2026-11-04T03:00:00Z' } }))
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    expect(screen.getByRole('button', { name: '已知晓' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
    expect(screen.getByText(/^已回执:已知晓,/)).toBeInTheDocument()
    expect(noticesApi.ack).not.toHaveBeenCalled()
  })

  it('choice 点修改后取消,回到已回执视图', () => {
    renderForm(
      item({
        ack: choiceAck,
        my_ack: { choice: 0, note: null, acked_at: '2026-11-04T03:00:00Z' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '提交回执' })).toBeNull()
    expect(screen.getByRole('button', { name: '修改' })).toBeInTheDocument()
  })

  it('confirm 已回执:选项处写"已知晓"', () => {
    renderForm(item({ my_ack: { choice: null, note: null, acked_at: '2026-11-04T03:00:00Z' } }))
    expect(screen.getByText(/^已回执:已知晓,/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修改' })).toBeInTheDocument()
  })

  // 不能回执的原因由后端给(ack_block_reason,L88),前端不再按时间 / 学生列表推断
  const REASONS = [
    '已撤回',
    '已截止',
    '孩子已毕业或离校,不能回执',
    '由主家长回执',
    '与孩子的关联已结束,不能回执',
  ]
  const blocked: [NonNullable<InboxItem['ack_block_reason']>, string, Partial<InboxItem>][] = [
    ['recalled', '已撤回', { recalled: true }],
    ['closed', '已截止', { ack_deadline: FUTURE }], // 浏览器时钟偏慢:截止在"未来"也听后端的
    ['readonly', '孩子已毕业或离校,不能回执', { ack_deadline: FUTURE, students: ['小明'] }],
    ['not_primary', '由主家长回执', { students: ['小明'] }],
  ]
  it.each(blocked)('can_ack=false:%s → %s', (reason, text, over) => {
    renderForm(item({ can_ack: false, ack_block_reason: reason, ...over }))
    expect(screen.getByText(text)).toBeInTheDocument()
    for (const other of REASONS.filter((r) => r !== text)) {
      expect(screen.queryByText(other)).toBeNull()
    }
    expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
  })

  // L231:绑定已结束 / 孩子已删是 unlinked,与 readonly(孩子毕业或离校)分开说
  it('unlinked reason copy', () => {
    renderForm(item({ can_ack: false, ack_block_reason: 'unlinked', ack_deadline: FUTURE }))
    expect(screen.getByText('与孩子的关联已结束,不能回执')).toBeInTheDocument()
    expect(screen.queryByText('孩子已毕业或离校,不能回执')).toBeNull()
    expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
  })

  // Review Focus 4:后端将来再加新值、或旧前端缓存遇到新后端,查不到文案就不显示原因,不编造
  it('unknown reason shows nothing', () => {
    const unknown = 'archived' as unknown as InboxItem['ack_block_reason']
    renderForm(item({ can_ack: false, ack_block_reason: unknown }))
    for (const r of REASONS) expect(screen.queryByText(r)).toBeNull()
    expect(screen.queryByText('archived')).toBeNull()
    expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
  })

  it('can_ack=false 但后端没给原因时不编造文案;过期的截止时间也不再推断"已截止"', () => {
    renderForm(item({ can_ack: false, ack_block_reason: null, ack_deadline: PAST }))
    for (const r of REASONS) expect(screen.queryByText(r)).toBeNull()
    expect(screen.queryByRole('button', { name: '已知晓' })).toBeNull()
  })

  it('已回执但不能再改:显示回执,不显示修改', () => {
    renderForm(
      item({
        can_ack: false,
        ack_block_reason: 'closed',
        ack_deadline: PAST,
        my_ack: { choice: null, note: null, acked_at: '2026-11-04T03:00:00Z' },
      }),
    )
    expect(screen.getByText(/^已回执:已知晓,/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修改' })).toBeNull()
    expect(screen.getByText('已截止')).toBeInTheDocument()
  })

  it('有截止时间时显示 MM-DD HH:mm 截止', () => {
    renderForm(item({ ack_deadline: FUTURE }))
    expect(screen.getByText(/^\d{2}-\d{2} \d{2}:\d{2} 截止$/)).toBeInTheDocument()
  })

  it('409 显示后端 message,按钮仍可重试', async () => {
    vi.mocked(noticesApi.ack).mockRejectedValue(new ApiError(409, 'ACK_CLOSED', '回执已截止'))
    renderForm(item())
    fireEvent.click(screen.getByRole('button', { name: '已知晓' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('回执已截止')
    expect(screen.getByRole('button', { name: '已知晓' })).toBeEnabled()
  })
})

// ---------- AckStatsDialog ----------
const row = (over: Partial<AckRow> = {}): AckRow => ({
  user_id: 'u1',
  user_name: '张妈妈',
  student_id: 's1',
  student_name: '张小明',
  class_name: '三年二班',
  read_at: null,
  choice: null,
  note: null,
  acked_at: null,
  ...over,
})
const parentRows: AckRow[] = [
  row({
    user_id: 'u1',
    user_name: '张妈妈',
    student_id: 's1',
    student_name: '张小明',
    read_at: '2026-11-04T02:00:00Z',
    choice: 0,
    note: '会到',
    acked_at: '2026-11-04T03:00:00Z',
  }),
  row({
    user_id: 'u2',
    user_name: '李爸爸',
    student_id: 's2',
    student_name: '李小红',
    read_at: '2026-11-04T02:30:00Z',
  }),
  row({ user_id: 'u3', user_name: '王妈妈', student_id: 's3', student_name: '王小刚' }),
  row({
    user_id: 'u3',
    user_name: '王妈妈',
    student_id: 's4',
    student_name: '王小丽',
    class_name: '三年一班',
  }),
]
const stats = (over: Partial<AckStats> = {}): AckStats => ({
  audience: 'parents',
  ack: choiceAck,
  ack_deadline: null,
  total: 4,
  read: 2,
  acked: 1,
  counts: [1, 0],
  students_without_parent: 0,
  rows: parentRows,
  ...over,
})
const renderStats = (s: AckStats, onClose = vi.fn()) => {
  vi.mocked(noticesApi.acks).mockResolvedValue(s)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AckStatsDialog noticeId="n1" onClose={onClose} />
    </QueryClientProvider>,
  )
  return qc
}

describe('AckStatsDialog', () => {
  it('关掉再打开会重新请求,不先显示缓存里的旧统计', async () => {
    const qc = renderStats(stats())
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    cleanup()
    vi.mocked(noticesApi.acks).mockClear()
    vi.mocked(noticesApi.acks).mockResolvedValue(stats({ read: 3, acked: 2 }))
    render(
      <QueryClientProvider client={qc}>
        <AckStatsDialog noticeId="n1" onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('已读 3 / 4 · 已回执 2 / 4')).toBeInTheDocument()
    expect(noticesApi.acks).toHaveBeenCalledTimes(1)
  })

  it('顶部计数与单选条形统计', async () => {
    renderStats(stats())
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText('已读 2 / 4 · 已回执 1 / 4')).toBeInTheDocument()
    expect(noticesApi.acks).toHaveBeenCalledWith('n1')
    const bars = within(dlg).getByRole('list', { name: '选项统计' })
    const items = within(bars).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('参加')
    expect(items[0]).toHaveTextContent('1 人')
    expect(items[1]).toHaveTextContent('不参加')
    expect(items[1]).toHaveTextContent('0 人')
  })

  it('confirm / none 没有条形统计', async () => {
    renderStats(stats({ ack: { kind: 'confirm' }, counts: [] }))
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    expect(screen.queryByRole('list', { name: '选项统计' })).toBeNull()
  })

  it('三个名单页签:已回执 / 未回执 / 未读,家长对象按学生显示班级、学生、家长', async () => {
    renderStats(stats())
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    const tabs = screen.getByRole('tablist', { name: '名单' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['已回执', '未回执', '未读'])
    // 默认:已回执
    expect(screen.getByRole('tab', { name: '已回执' })).toHaveAttribute('aria-selected', 'true')
    let table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['班级', '学生', '家长', '回执'])
    let body = within(table).getAllByRole('row').slice(1)
    expect(body).toHaveLength(1)
    expect(body[0]).toHaveTextContent('三年二班')
    expect(body[0]).toHaveTextContent('张小明')
    expect(body[0]).toHaveTextContent('张妈妈')
    expect(body[0]).toHaveTextContent('参加')
    expect(body[0]).toHaveTextContent('会到')

    fireEvent.click(screen.getByRole('tab', { name: '未回执' }))
    table = screen.getByRole('table')
    body = within(table).getAllByRole('row').slice(1)
    expect(body.map((r) => r.textContent)).toEqual([
      expect.stringContaining('李小红'),
      expect.stringContaining('王小刚'),
      expect.stringContaining('王小丽'),
    ])

    fireEvent.click(screen.getByRole('tab', { name: '未读' }))
    table = screen.getByRole('table')
    body = within(table).getAllByRole('row').slice(1)
    expect(body).toHaveLength(2)
    expect(body[0]).toHaveTextContent('王小刚')
    expect(body[1]).toHaveTextContent('王小丽')
    expect(body[1]).toHaveTextContent('三年一班')
  })

  it('老师对象显示姓名', async () => {
    renderStats(
      stats({
        audience: 'teachers',
        ack: { kind: 'confirm' },
        counts: [],
        total: 2,
        read: 1,
        acked: 0,
        rows: [
          row({
            user_id: 't1',
            user_name: '赵老师',
            student_id: null,
            student_name: null,
            class_name: null,
            read_at: '2026-11-04T02:00:00Z',
          }),
          row({
            user_id: 't2',
            user_name: '钱老师',
            student_id: null,
            student_name: null,
            class_name: null,
          }),
        ],
      }),
    )
    await screen.findByText('已读 1 / 2 · 已回执 0 / 2')
    fireEvent.click(screen.getByRole('tab', { name: '未回执' }))
    const table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['姓名'])
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(['赵老师', '钱老师'])
    fireEvent.click(screen.getByRole('tab', { name: '未读' }))
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(['钱老师'])
  })

  it('空名单显示空提示', async () => {
    renderStats(stats({ acked: 0, counts: [0, 0], rows: parentRows.slice(1) }))
    await screen.findByText('已读 2 / 4 · 已回执 0 / 4')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('暂无')).toBeInTheDocument()
  })

  it('有学生没绑定家长时提示,没有时不提示', async () => {
    renderStats(stats({ students_without_parent: 3 }))
    expect(await screen.findByText('另有 3 名学生还没有绑定家长')).toBeInTheDocument()
    cleanup()
    renderStats(stats())
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    expect(screen.queryByText(/还没有绑定家长/)).toBeNull()
  })

  it('导出 CSV:调 exportAcks 并用 Blob 触发下载', async () => {
    const blob = new Blob(['a,b'])
    vi.mocked(noticesApi.exportAcks).mockResolvedValue(blob)
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderStats(stats())
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(blob))
    expect(noticesApi.exportAcks).toHaveBeenCalledWith('n1')
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('导出失败显示后端 message', async () => {
    vi.mocked(noticesApi.exportAcks).mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', '没有这条通知'),
    )
    renderStats(stats())
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }))
    expect(await screen.findByText('没有这条通知')).toBeInTheDocument()
  })

  it('加载失败显示错误并可重试', async () => {
    vi.mocked(noticesApi.acks).mockRejectedValueOnce(new ApiError(500, 'X', '服务器错误'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AckStatsDialog noticeId="n1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('回执统计加载失败')).toBeInTheDocument()
    vi.mocked(noticesApi.acks).mockResolvedValue(stats())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('已读 2 / 4 · 已回执 1 / 4')).toBeInTheDocument()
  })

  it('关闭回调', async () => {
    const onClose = vi.fn()
    renderStats(stats(), onClose)
    await screen.findByText('已读 2 / 4 · 已回执 1 / 4')
    fireEvent.click(screen.getByRole('button', { name: /关闭|Close/ }))
    expect(onClose).toHaveBeenCalled()
  })
})
