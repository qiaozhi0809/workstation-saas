import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { noticesApi } from '@/shared/api/notices'
import type { AckStats, NoticeOptions, NoticePerson, NoticeSent } from '@/shared/types/admin'
import NoticesPage from './NoticesPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    noticeOptions: vi.fn(), noticePeople: vi.fn(), sendNotice: vi.fn(),
    sentNotices: vi.fn(), noticeRecipients: vi.fn(), recallNotice: vi.fn(),
  },
}))
vi.mock('@/shared/api/notices', () => ({ noticesApi: { acks: vi.fn() } }))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const sent = (id: string, over: Partial<NoticeSent> = {}): NoticeSent => ({
  id, title: `通知${id}`, content: '正文', target_label: '全校老师', created_at: '2026-11-04T01:00:00Z',
  recalled_at: null, recipients: 10, read: 4,
  audience: 'teachers', ack: { kind: 'none' }, ack_deadline: null, acked: 0, students_without_parent: 0, ...over,
})
const options = (over: Partial<NoticeOptions> = {}): NoticeOptions => ({
  school_wide: true,
  grades: [{ id: 'g3', name: '三年级' }, { id: 'g4', name: '四年级' }],
  classes: [
    { id: 'c31', name: '三年一班', grade_id: 'g3' }, { id: 'c32', name: '三年二班', grade_id: 'g3' },
    { id: 'c41', name: '四年一班', grade_id: 'g4' },
  ],
  ...over,
})
const people: NoticePerson[] = [
  { user_id: 'u1', name: '李明', tags: ['三年一班班主任'] },
  { user_id: 'u2', name: '王芳', tags: ['数学'] },
]

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NoticesPage />
  </QueryClientProvider>,
)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.noticeOptions).mockResolvedValue(options())
  vi.mocked(adminApi.noticePeople).mockResolvedValue(people)
  vi.mocked(adminApi.sentNotices).mockResolvedValue({ items: [sent('1')], total: 1 })
  vi.mocked(adminApi.sendNotice).mockResolvedValue(sent('9', { recipients: 12 }))
})
afterEach(cleanup)

const fill = async (kind?: string) => {
  fireEvent.change(await screen.findByLabelText('标题'), { target: { value: '  期中考试通知  ' } })
  fireEvent.change(screen.getByLabelText('正文'), { target: { value: '下周三开始期中考试' } })
  if (kind) fireEvent.change(screen.getByLabelText('发给'), { target: { value: kind } })
}
const clickSend = () => fireEvent.click(screen.getByRole('button', { name: '发送' }))
const confirmDialog = async () => within(await screen.findByRole('dialog', { name: '发送通知' }))

describe('发通知:编写', () => {
  it('offers school, grade, class and people targets to a school-scope sender', async () => {
    renderPage()
    const select = await screen.findByLabelText('发给')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['全校老师', '某个年级', '某个班', '指定的人'])
  })

  it('offers a grade head no 全校老师 and only the visible grade', async () => {
    vi.mocked(adminApi.noticeOptions).mockResolvedValue(options({
      school_wide: false, grades: [{ id: 'g3', name: '三年级' }],
      classes: [{ id: 'c31', name: '三年一班', grade_id: 'g3' }],
    }))
    renderPage()
    const select = await screen.findByLabelText('发给')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['某个年级', '某个班', '指定的人'])
    expect(screen.queryByRole('option', { name: '全校老师' })).toBeNull()
    const grades = await screen.findByLabelText('年级')
    expect(within(grades).getAllByRole('option').map((o) => o.textContent)).toEqual(['三年级'])
  })

  it('keeps 发送 disabled until title and body are filled', async () => {
    renderPage()
    const send = await screen.findByRole('button', { name: '发送' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '放假' } })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '周五放假' } })
    expect(send).toBeEnabled()
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '   ' } })
    expect(send).toBeDisabled()
  })

  it('asks with the target text, then sends to the whole school and reports the head count', async () => {
    renderPage()
    await fill()
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('确认发给 全校老师?')).toBeInTheDocument()
    expect(adminApi.sendNotice).not.toHaveBeenCalled()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith({
      title: '期中考试通知', content: '下周三开始期中考试', target: { kind: 'school' },
      audience: 'teachers', ack: { kind: 'none' }, ack_deadline: null,
    }))
    expect(await screen.findByText('已发给 12 人')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '发送通知' })).toBeNull()
    expect(screen.getByLabelText('标题')).toHaveValue('')
    expect(screen.getByLabelText('正文')).toHaveValue('')
    await waitFor(() => expect(adminApi.sentNotices).toHaveBeenCalledTimes(2))
  })

  it('does not send when the confirmation is cancelled', async () => {
    renderPage()
    await fill()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '发送通知' })).toBeNull())
    expect(adminApi.sendNotice).not.toHaveBeenCalled()
    expect(screen.getByLabelText('标题')).toHaveValue('  期中考试通知  ')
  })

  it('sends to one grade', async () => {
    renderPage()
    await fill('grade')
    const grades = await screen.findByLabelText('年级')
    await waitFor(() => expect(grades).toHaveValue('g3'))
    fireEvent.change(grades, { target: { value: 'g4' } })
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('确认发给 四年级老师?')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'grade', grade_id: 'g4' } })))
  })

  it('sends to one class, picking the grade first', async () => {
    renderPage()
    await fill('class')
    const classes = await screen.findByLabelText('班级')
    await waitFor(() => expect(within(classes).getAllByRole('option').map((o) => o.textContent)).toEqual(['请选择班级', '三年一班', '三年二班']))
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.change(classes, { target: { value: 'c32' } })
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('确认发给 三年二班老师?')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'class', class_id: 'c32' } })))
  })

  it('lists the classes of the grade picked for a class target', async () => {
    renderPage()
    await fill('class')
    fireEvent.change(await screen.findByLabelText('年级'), { target: { value: 'g4' } })
    const classes = screen.getByLabelText('班级')
    await waitFor(() => expect(within(classes).getAllByRole('option').map((o) => o.textContent)).toEqual(['请选择班级', '四年一班']))
  })

  it('searches and picks named people, keeping picks across searches', async () => {
    vi.mocked(adminApi.noticePeople).mockImplementation(async (q) => (q === 'wang' ? [people[1]] : [people[0]]))
    renderPage()
    await fill('users')
    expect(await screen.findByRole('button', { name: '添加 李明' })).toBeInTheDocument()
    expect(adminApi.noticePeople).toHaveBeenCalledWith('')
    expect(screen.getByText('三年一班班主任')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '添加 李明' }))
    expect(screen.getByRole('button', { name: '已选 李明' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('搜索姓名或登录名'), { target: { value: 'wang' } })
    fireEvent.click(await screen.findByRole('button', { name: '添加 王芳' }))
    expect(adminApi.noticePeople).toHaveBeenCalledWith('wang')
    const picked = screen.getByRole('list', { name: '已选择的人' })
    expect(within(picked).getAllByRole('listitem').map((l) => l.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('李明'), expect.stringContaining('王芳'),
    ]))
    fireEvent.click(within(picked).getByRole('button', { name: '移除 王芳' }))
    expect(within(picked).queryByText('王芳')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '添加 王芳' }))
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('确认发给 指定 2 人?')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'users', user_ids: ['u1', 'u2'] } })))
  })

  it('shows the server message when sending fails and keeps the draft', async () => {
    vi.mocked(adminApi.sendNotice).mockRejectedValue(new ApiError(400, 'NO_RECIPIENTS', '没有可发送的人'))
    renderPage()
    await fill()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('没有可发送的人')
    expect(screen.getByLabelText('标题')).toHaveValue('  期中考试通知  ')
  })
})

describe('发通知:可选对象加载', () => {
  const OPT_KEY = ['notices', 'options']
  it('keeps the draft when a background refetch of the options fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><NoticesPage /></QueryClientProvider>)
    await fill()
    act(() => {
      client.getQueryCache().find({ queryKey: OPT_KEY })!
        .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' })
    })
    expect(client.getQueryState(OPT_KEY)?.data).toBeDefined()
    expect(screen.getByLabelText('标题')).toHaveValue('  期中考试通知  ')
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument()
  })

  it('still shows the error state when the options never loaded', async () => {
    vi.mocked(adminApi.noticeOptions).mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('加载失败')).toBeInTheDocument()
  })
})

describe('发通知:发给家长', () => {
  const pickParents = async () => {
    await fill()
    fireEvent.click(screen.getByRole('radio', { name: '家长' }))
  }

  it('offers only 全校家长 / 某个年级 / 某个班 for parents, with parent labels', async () => {
    renderPage()
    await pickParents()
    const select = screen.getByLabelText('发给')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['全校家长', '某个年级', '某个班'])
  })

  it('has no 全校 option for a grade head even for parents', async () => {
    vi.mocked(adminApi.noticeOptions).mockResolvedValue(options({ school_wide: false }))
    renderPage()
    await pickParents()
    expect(within(screen.getByLabelText('发给')).getAllByRole('option').map((o) => o.textContent)).toEqual(['某个年级', '某个班'])
  })

  it('resets a 指定的人 target and the picks when switching to parents', async () => {
    renderPage()
    await fill('users')
    fireEvent.click(await screen.findByRole('button', { name: '添加 李明' }))
    fireEvent.click(screen.getByRole('radio', { name: '家长' }))
    expect(screen.getByLabelText('发给')).toHaveValue('school')
    fireEvent.click(screen.getByRole('radio', { name: '老师' }))
    fireEvent.change(screen.getByLabelText('发给'), { target: { value: 'users' } })
    expect(await screen.findByRole('button', { name: '添加 李明' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '已选择的人' })).toBeNull()
  })

  it('resets to 某个年级 for a grade head switching from 指定的人 to parents', async () => {
    vi.mocked(adminApi.noticeOptions).mockResolvedValue(options({ school_wide: false }))
    renderPage()
    await fill('users')
    fireEvent.click(screen.getByRole('radio', { name: '家长' }))
    expect(screen.getByLabelText('发给')).toHaveValue('grade')
  })

  it('sends audience parents with the parent label in the confirmation', async () => {
    renderPage()
    await pickParents()
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('确认发给 全校家长?')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'school' }, audience: 'parents' })))
  })

  it('labels grade and class parents', async () => {
    renderPage()
    await pickParents()
    fireEvent.change(screen.getByLabelText('发给'), { target: { value: 'grade' } })
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: 'g4' } })
    clickSend()
    expect(await (await confirmDialog()).findByText('确认发给 四年级家长?')).toBeInTheDocument()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '发送通知' })).toBeNull())
    fireEvent.change(screen.getByLabelText('发给'), { target: { value: 'class' } })
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: 'g3' } })
    fireEvent.change(screen.getByLabelText('班级'), { target: { value: 'c32' } })
    clickSend()
    expect(await (await confirmDialog()).findByText('确认发给 三年二班家长?')).toBeInTheDocument()
  })
})

describe('发通知:对象选项来自 noticeOptions', () => {
  it('corrects a school target when a refreshed options drops school_wide', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><NoticesPage /></QueryClientProvider>)
    await fill()
    expect(screen.getByLabelText('发给')).toHaveValue('school')
    act(() => { client.setQueryData(['notices', 'options'], options({ school_wide: false })) })
    await waitFor(() => expect(screen.getByLabelText('发给')).toHaveValue('grade'))
    clickSend()
    expect((await confirmDialog()).getByText('确认发给 三年级老师?')).toBeInTheDocument()
  })

  it('falls back to the first grade when a refreshed options drops the picked grade', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><NoticesPage /></QueryClientProvider>)
    await fill('grade')
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: 'g4' } })
    act(() => {
      client.setQueryData(['notices', 'options'], options({
        grades: [{ id: 'g3', name: '三年级' }], classes: [{ id: 'c31', name: '三年一班', grade_id: 'g3' }],
      }))
    })
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'grade', grade_id: 'g3' } })))
  })

  it('omits 全校老师 when school_wide is false', async () => {
    vi.mocked(adminApi.noticeOptions).mockResolvedValue(options({ school_wide: false }))
    renderPage()
    const select = await screen.findByLabelText('发给')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['某个年级', '某个班', '指定的人'])
  })

  it('filters classes by the picked grade', async () => {
    renderPage()
    await fill('class')
    const classes = await screen.findByLabelText('班级')
    expect(within(classes).getAllByRole('option').map((o) => o.textContent)).toEqual(['请选择班级', '三年一班', '三年二班'])
    fireEvent.change(screen.getByLabelText('年级'), { target: { value: 'g4' } })
    expect(within(screen.getByLabelText('班级')).getAllByRole('option').map((o) => o.textContent)).toEqual(['请选择班级', '四年一班'])
  })
})

describe('发通知:回执', () => {
  const chooseKind = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))

  it('sends the confirm ack and a deadline normalised', async () => {
    renderPage()
    await fill()
    chooseKind('已知晓')
    const future = new Date(Date.now() + 86400_000 * 3)
    const pad = (n: number) => String(n).padStart(2, '0')
    fireEvent.change(screen.getByLabelText('截止时间'), {
      target: { value: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T10:00` },
    })
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('回执:已知晓')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalled())
    const body = vi.mocked(adminApi.sendNotice).mock.calls[0][0]
    expect(body.ack).toEqual({ kind: 'confirm' })
    expect(typeof body.ack_deadline).toBe('string')
    expect(new Date(body.ack_deadline!).getTime()).toBeGreaterThan(Date.now())
  })

  it('writes the choice ack into the confirmation and request, trimming options', async () => {
    renderPage()
    await fill()
    chooseKind('单选')
    fireEvent.change(screen.getByLabelText('选项 1'), { target: { value: ' 参加 ' } })
    fireEvent.change(screen.getByLabelText('选项 2'), { target: { value: '不参加' } })
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    fireEvent.change(screen.getByLabelText('选项 3'), { target: { value: '待定' } })
    clickSend()
    const dlg = await confirmDialog()
    expect(dlg.getByText('回执:单选(3 项)')).toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenCalledWith(expect.objectContaining({
      ack: { kind: 'choice', options: ['参加', '不参加', '待定'], allow_note: false }, ack_deadline: null,
    })))
  })

  it('says 不要回执 in the confirmation by default', async () => {
    renderPage()
    await fill()
    clickSend()
    expect((await confirmDialog()).getByText('回执:不要回执')).toBeInTheDocument()
  })

  it('does not send with too few choice options (no dialog, no request)', async () => {
    renderPage()
    await fill()
    chooseKind('单选')
    fireEvent.change(screen.getByLabelText('选项 1'), { target: { value: '参加' } })
    clickSend()
    expect((await screen.findAllByText('至少要 2 个选项')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog', { name: '发送通知' })).toBeNull()
    expect(adminApi.sendNotice).not.toHaveBeenCalled()
  })

  it('does not send with duplicate choice options', async () => {
    renderPage()
    await fill()
    chooseKind('单选')
    fireEvent.change(screen.getByLabelText('选项 1'), { target: { value: '参加' } })
    fireEvent.change(screen.getByLabelText('选项 2'), { target: { value: '参加' } })
    clickSend()
    expect((await screen.findAllByText('选项不能重复')).length).toBeGreaterThan(0)
    expect(adminApi.sendNotice).not.toHaveBeenCalled()
  })

  it('does not send when the deadline is already past', async () => {
    renderPage()
    await fill()
    chooseKind('已知晓')
    fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '2020-01-01T10:00' } })
    clickSend()
    expect((await screen.findAllByText('截止时间要晚于现在')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog', { name: '发送通知' })).toBeNull()
    expect(adminApi.sendNotice).not.toHaveBeenCalled()
  })

  it('blocks 确认发送 too when the ack went bad after the dialog opened', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
      renderPage()
      await fill()
      chooseKind('已知晓')
      fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '2026-11-05T10:00' } })
      clickSend()
      const dlg = await confirmDialog()
      vi.setSystemTime(new Date('2026-11-06T00:00:00Z'))
      fireEvent.click(dlg.getByRole('button', { name: '确认发送' }))
      expect(await dlg.findByRole('alert')).toHaveTextContent('截止时间要晚于现在')
      expect(adminApi.sendNotice).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('发通知:指定的人失效(409)', () => {
  const unavailable = () => new ApiError(409, 'RECIPIENT_UNAVAILABLE', '有 1 位已不能接收通知,请去掉后重发', { user_ids: ['u2'] })

  const pickBoth = async () => {
    await fill('users')
    fireEvent.click(await screen.findByRole('button', { name: '添加 李明' }))
    fireEvent.click(screen.getByRole('button', { name: '添加 王芳' }))
  }

  it('marks unavailable people, removes them in one click and resends', async () => {
    vi.mocked(adminApi.noticePeople).mockResolvedValue(people)
    vi.mocked(adminApi.sendNotice).mockRejectedValueOnce(unavailable())
    renderPage()
    await pickBoth()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    const picked = await screen.findByRole('list', { name: '已选择的人' })
    expect(await within(picked).findByText('已不可选')).toBeInTheDocument()
    expect(within(picked).getAllByText('已不可选')).toHaveLength(1)
    expect(within(picked.querySelectorAll('li')[1] as HTMLElement).getByText('已不可选')).toBeInTheDocument()
    expect(screen.getByText('有 1 位已不能接收通知,请去掉后重发')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '去掉这些人' }))
    expect(within(screen.getByRole('list', { name: '已选择的人' })).queryByText('王芳')).toBeNull()
    expect(screen.queryByText('已不可选')).toBeNull()
    expect(screen.queryByRole('button', { name: '去掉这些人' })).toBeNull()
    expect(screen.queryByText('有 1 位已不能接收通知,请去掉后重发')).toBeNull()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    await waitFor(() => expect(adminApi.sendNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { kind: 'users', user_ids: ['u1'] } })))
  })

  it('treats a 409 whose ids match nobody picked as a plain error', async () => {
    vi.mocked(adminApi.sendNotice).mockRejectedValueOnce(
      new ApiError(409, 'RECIPIENT_UNAVAILABLE', '有 1 位已不能接收通知', { user_ids: ['u99'] }))
    renderPage()
    await pickBoth()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    const dlg = await confirmDialog()
    expect(await dlg.findByRole('alert')).toHaveTextContent('有 1 位已不能接收通知')
    expect(screen.queryByText('已不可选')).toBeNull()
    expect(screen.queryByRole('button', { name: '去掉这些人' })).toBeNull()
  })

  it('clears the unavailable marks when switching the target away and back', async () => {
    vi.mocked(adminApi.sendNotice).mockRejectedValueOnce(unavailable())
    renderPage()
    await pickBoth()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    await screen.findByText('已不可选')
    fireEvent.change(screen.getByLabelText('发给'), { target: { value: 'school' } })
    fireEvent.change(screen.getByLabelText('发给'), { target: { value: 'users' } })
    expect(await screen.findByRole('list', { name: '已选择的人' })).toBeInTheDocument()
    expect(screen.queryByText('已不可选')).toBeNull()
    expect(screen.queryByRole('button', { name: '去掉这些人' })).toBeNull()
  })

  it('keeps the generic error for a 409 with other code or invalid details', async () => {
    vi.mocked(adminApi.sendNotice).mockRejectedValueOnce(new ApiError(409, 'RECIPIENT_UNAVAILABLE', '名单有变', { user_ids: 'x' }))
    renderPage()
    await pickBoth()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('名单有变')
    expect(screen.queryByText('已不可选')).toBeNull()
    expect(screen.queryByRole('button', { name: '去掉这些人' })).toBeNull()
  })
})

describe('发通知:我发出的', () => {
  it('lists title, target, time and read ratio', async () => {
    vi.mocked(adminApi.sentNotices).mockResolvedValue({
      items: [sent('1', { title: '期中考试通知', target_label: '三年级老师', recipients: 8, read: 3 })], total: 1,
    })
    renderPage()
    const row = (await screen.findByRole('button', { name: '期中考试通知' })).closest('li') as HTMLElement
    expect(within(row).getByText(/三年级老师/)).toBeInTheDocument()
    expect(within(row).getByText('已读 3 / 8')).toBeInTheDocument()
    expect(adminApi.sentNotices).toHaveBeenCalledWith(1)
  })

  it('shows an empty state', async () => {
    vi.mocked(adminApi.sentNotices).mockResolvedValue({ items: [], total: 0 })
    renderPage()
    expect(await screen.findByText('还没有发出过通知')).toBeInTheDocument()
  })

  it('opens the read and unread names', async () => {
    vi.mocked(adminApi.noticeRecipients).mockResolvedValue({
      read: [{ user_id: 'u1', name: '李明', read_at: '2026-11-04T02:00:00Z' }],
      unread: [{ user_id: 'u2', name: '王芳' }, { user_id: 'u3', name: '赵强' }],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '通知1' }))
    const dlg = within(await screen.findByRole('dialog', { name: '通知1' }))
    expect(await dlg.findByText('李明')).toBeInTheDocument()
    expect(adminApi.noticeRecipients).toHaveBeenCalledWith('1')
    expect(dlg.getByRole('heading', { name: '已读 1 人' })).toBeInTheDocument()
    expect(dlg.getByRole('heading', { name: '未读 2 人' })).toBeInTheDocument()
    expect(dlg.getByText('王芳')).toBeInTheDocument()
    expect(dlg.getByText('赵强')).toBeInTheDocument()
  })

  it('recalls after confirmation and refreshes the list', async () => {
    vi.mocked(adminApi.recallNotice).mockResolvedValue(sent('1', { recalled_at: '2026-11-04T05:00:00Z' }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '撤回 通知1' }))
    const dlg = within(await screen.findByRole('dialog', { name: '撤回通知' }))
    expect(dlg.getByText('确认撤回「通知1」?')).toBeInTheDocument()
    expect(adminApi.recallNotice).not.toHaveBeenCalled()
    vi.mocked(adminApi.sentNotices).mockResolvedValue({ items: [sent('1', { recalled_at: '2026-11-04T05:00:00Z' })], total: 1 })
    fireEvent.click(dlg.getByRole('button', { name: '确认撤回' }))
    await waitFor(() => expect(adminApi.recallNotice).toHaveBeenCalledWith('1'))
    await waitFor(() => expect(adminApi.sentNotices).toHaveBeenCalledTimes(2))
    expect(toast).toHaveBeenCalledWith('已撤回')
    expect(await screen.findByText('已撤回')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤回 通知1' })).toBeNull()
  })

  it('shows the server message when recalling fails', async () => {
    vi.mocked(adminApi.recallNotice).mockRejectedValue(new ApiError(404, 'NOT_FOUND', '通知不存在'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '撤回 通知1' }))
    await screen.findByRole('dialog', { name: '撤回通知' })
    fireEvent.click(screen.getByRole('button', { name: '确认撤回' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通知不存在')
  })

  it('goes back to page 1 and refreshes after a successful send', async () => {
    vi.mocked(adminApi.sentNotices).mockImplementation(async (page) => ({ items: [sent(`p${page}`)], total: 45 }))
    renderPage()
    await screen.findByRole('button', { name: '通知p1' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByRole('button', { name: '通知p2' })
    await fill()
    clickSend()
    fireEvent.click((await confirmDialog()).getByRole('button', { name: '确认发送' }))
    await screen.findByText('已发给 12 人')
    await waitFor(() => expect(adminApi.sentNotices).toHaveBeenLastCalledWith(1))
    expect(await screen.findByRole('button', { name: '通知p1' })).toBeInTheDocument()
    expect(screen.getByText('共 45 条,第 1 / 3 页')).toBeInTheDocument()
  })

  it('tags parent notices and shows ack progress only when an ack is required', async () => {
    vi.mocked(adminApi.sentNotices).mockResolvedValue({
      items: [
        sent('1', { title: '家长会', audience: 'parents', target_label: '三年二班家长', recipients: 30, read: 12,
          ack: { kind: 'confirm' }, acked: 9 }),
        sent('2', { title: '普通通知' }),
      ], total: 2,
    })
    renderPage()
    const row1 = (await screen.findByRole('button', { name: '家长会' })).closest('li') as HTMLElement
    expect(within(row1).getByText('家长')).toBeInTheDocument()
    expect(within(row1).getByText('已读 12 / 30')).toBeInTheDocument()
    expect(within(row1).getByText('回执 9 / 30')).toBeInTheDocument()
    const row2 = screen.getByRole('button', { name: '普通通知' }).closest('li') as HTMLElement
    expect(within(row2).queryByText('家长')).toBeNull()
    expect(within(row2).queryByText(/回执 \d/)).toBeNull()
  })

  it('opens the ack stats dialog for a notice with ack, the recipients dialog otherwise', async () => {
    const stats: AckStats = {
      audience: 'parents', ack: { kind: 'confirm' }, ack_deadline: null, total: 30, read: 12, acked: 9,
      counts: [], students_without_parent: 0, rows: [],
    }
    vi.mocked(noticesApi.acks).mockResolvedValue(stats)
    vi.mocked(adminApi.noticeRecipients).mockResolvedValue({ read: [], unread: [] })
    vi.mocked(adminApi.sentNotices).mockResolvedValue({
      items: [sent('1', { title: '家长会', audience: 'parents', ack: { kind: 'confirm' }, acked: 9 }), sent('2', { title: '普通通知' })],
      total: 2,
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '家长会' }))
    await waitFor(() => expect(noticesApi.acks).toHaveBeenCalledWith('1'))
    expect(adminApi.noticeRecipients).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '普通通知' }))
    await waitFor(() => expect(adminApi.noticeRecipients).toHaveBeenCalledWith('2'))
    expect(noticesApi.acks).toHaveBeenCalledTimes(1)
  })
})
