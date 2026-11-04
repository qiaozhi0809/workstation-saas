import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import type { BoardView, NoticePerson, NoticeSent, TodayView } from '@/shared/types/admin'
import NoticesPage from './NoticesPage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    today: vi.fn(), board: vi.fn(), noticePeople: vi.fn(), sendNotice: vi.fn(),
    sentNotices: vi.fn(), noticeRecipients: vi.fn(), recallNotice: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const sent = (id: string, over: Partial<NoticeSent> = {}): NoticeSent => ({
  id, title: `通知${id}`, content: '正文', target_label: '全校老师', created_at: '2026-11-04T01:00:00Z',
  recalled_at: null, recipients: 10, read: 4, ...over,
})
const board = (over: Partial<BoardView> = {}): BoardView => ({
  grades: [{ id: 'g3', name: '三年级' }, { id: 'g4', name: '四年级' }], grade_id: 'g3',
  classes: [
    { id: 'c31', name: '三年一班' }, { id: 'c32', name: '三年二班' },
  ] as unknown as BoardView['classes'],
  ...over,
})
const people: NoticePerson[] = [
  { user_id: 'u1', name: '李明', tags: ['三年一班班主任'] },
  { user_id: 'u2', name: '王芳', tags: ['数学'] },
]

const today = (scope_label: string) => ({ scope_label }) as unknown as TodayView

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NoticesPage />
  </QueryClientProvider>,
)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.today).mockResolvedValue(today('全校'))
  vi.mocked(adminApi.board).mockImplementation(async (gradeId) =>
    gradeId === 'g4'
      ? board({ grade_id: 'g4', classes: [{ id: 'c41', name: '四年一班' }] as unknown as BoardView['classes'] })
      : board())
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
    vi.mocked(adminApi.today).mockResolvedValue(today('三年级'))
    vi.mocked(adminApi.board).mockResolvedValue(board({ grades: [{ id: 'g3', name: '三年级' }] }))
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
    expect(adminApi.board).toHaveBeenCalledWith('g4')
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
})
