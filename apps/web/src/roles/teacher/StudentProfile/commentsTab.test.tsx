import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { classroomApi } from '@/shared/api/classroom'
import { commentsApi } from '@/shared/api/comments'
import { Toaster } from '@/shared/components/Toast'
import type { ClassPerm } from '@/shared/types/classroom'
import type { Comment } from '@/shared/types/comment'
import type { StudentProfile } from '@/shared/types/student'
import CommentsTab from './CommentsTab'
import ProfileActions from './ProfileActions'

vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/comments', () => ({
  commentsApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), setParentVisible: vi.fn() },
}))

const profile: StudentProfile = {
  id: 's1',
  mk: 'S0001',
  name: '王小一',
  class_id: 'c1',
  enrollment_id: 'e1',
}

const cm = (over: Partial<Comment>): Comment => ({
  id: 'm1',
  semester: '2026-2027 第一学期',
  content: '学习认真,进步明显',
  generated_by_ai: false,
  current_year: true,
  created_by_name: '李老师',
  can_delete: true,
  created_at: '2026-10-30T08:00:00Z',
  parent_visible: false,
  can_share: true,
  ...over,
})

function Loc() {
  const { pathname, search } = useLocation()
  return <div data-testid="loc">{pathname + search}</div>
}

function setup(ui: React.ReactElement, perms: ClassPerm[]) {
  vi.mocked(classroomApi.summary).mockResolvedValue({
    my_perms: perms,
    today: '2026-11-02',
    timezone: 'Asia/Shanghai',
  } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {ui}
        <Loc />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate, client }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [] })
  vi.mocked(commentsApi.create).mockResolvedValue(cm({}))
  vi.mocked(commentsApi.remove).mockResolvedValue(undefined)
})

it('lists comments newest first with AI / handwritten tags', async () => {
  vi.mocked(commentsApi.list).mockResolvedValue({
    items: [
      cm({
        id: 'm2',
        content: 'AI 写的评语',
        generated_by_ai: true,
        created_at: '2026-10-31T08:00:00Z',
      }),
      cm({ id: 'm1', content: '手写的评语', created_at: '2026-10-30T08:00:00Z' }),
    ],
  })
  setup(<CommentsTab profile={profile} />, ['comment.read'])
  const items = await screen.findAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('AI 写的评语')).toBeInTheDocument()
  expect(within(items[0]).getByText('AI 生成')).toBeInTheDocument()
  expect(within(items[0]).getByText('2026-10-31')).toBeInTheDocument()
  expect(within(items[0]).getByText('2026-2027 第一学期')).toBeInTheDocument()
  expect(within(items[1]).getByText('手写')).toBeInTheDocument()
})

it('saves a handwritten comment', async () => {
  const { invalidate } = setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  const box = await screen.findByLabelText('评语内容')
  expect(box).toHaveAttribute('maxlength', '1000')
  const save = screen.getByRole('button', { name: '保存评语' })
  expect(save).toBeDisabled()
  fireEvent.change(box, { target: { value: ' 本学期表现优秀 ' } })
  fireEvent.click(save)
  await waitFor(() =>
    expect(commentsApi.create).toHaveBeenCalledWith('s1', {
      content: '本学期表现优秀',
      generated_by_ai: false,
    }),
  )
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['comments', 's1'] }))
  await waitFor(() => expect(box).toHaveValue(''))
})

it('copies and deletes a comment', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  vi.mocked(commentsApi.list).mockResolvedValue({
    items: [cm({}), cm({ id: 'm3', content: '别人的评语', can_delete: false })],
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { invalidate } = setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  await screen.findByText('别人的评语')
  fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0])
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('学习认真,进步明显'))
  expect(await screen.findByText('已复制评语')).toBeInTheDocument()
  const del = screen.getAllByRole('button', { name: '删除' })
  expect(del).toHaveLength(1)
  fireEvent.click(del[0])
  expect(confirmSpy).toHaveBeenCalledWith('删除这条评语?')
  // 先冲掉微任务,再断言取消确认后没有发起删除
  await act(async () => {})
  expect(commentsApi.remove).not.toHaveBeenCalled()
  confirmSpy.mockReturnValue(true)
  fireEvent.click(del[0])
  await waitFor(() => expect(commentsApi.remove).toHaveBeenCalledWith('m1'))
  expect(commentsApi.remove).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['comments', 's1'] }))
  confirmSpy.mockRestore()
})

it('navigates to the AI comment template for this student', async () => {
  setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write', 'ai.class'])
  fireEvent.click(await screen.findByRole('button', { name: 'AI 生成' }))
  expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/ai?tpl=comment1&stu=s1')
})

it('hides AI 生成 without ai.class', async () => {
  setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  await screen.findByLabelText('评语内容')
  expect(screen.queryByRole('button', { name: 'AI 生成' })).not.toBeInTheDocument()
})

it('hides the form without comment.write', async () => {
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [cm({})] })
  setup(<CommentsTab profile={profile} />, ['comment.read'])
  expect(await screen.findByText('学习认真,进步明显')).toBeInTheDocument()
  expect(screen.queryByLabelText('评语内容')).not.toBeInTheDocument()
})

it('shows the homeroom-only state without comment.read', async () => {
  setup(<CommentsTab profile={profile} />, ['comment.write'])
  expect(await screen.findByText('只有班主任可以查看评语')).toBeInTheDocument()
  expect(commentsApi.list).not.toHaveBeenCalled()
})

it('shows an empty state without comments', async () => {
  setup(<CommentsTab profile={profile} />, ['comment.read'])
  expect(await screen.findByText('还没有评语')).toBeInTheDocument()
})

it('shows a retryable error when the classroom summary fails', async () => {
  vi.mocked(classroomApi.summary).mockRejectedValueOnce(new Error('boom'))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommentsTab profile={profile} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  vi.mocked(classroomApi.summary).mockResolvedValue({
    my_perms: ['comment.read'],
    today: '2026-11-02',
    timezone: 'Asia/Shanghai',
  } as never)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('还没有评语')).toBeInTheDocument()
})

it('shows a retryable error when the comment list fails', async () => {
  vi.mocked(commentsApi.list).mockRejectedValueOnce(new Error('boom'))
  setup(<CommentsTab profile={profile} />, ['comment.read'])
  expect(await screen.findByText('评语加载失败')).toBeInTheDocument()
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [cm({})] })
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('学习认真,进步明显')).toBeInTheDocument()
})

it('shows header AI actions only with ai.class', async () => {
  const { client } = setup(<ProfileActions profile={profile} />, ['comment.write'])
  // 等班级权限数据真正到达并渲染完,再断言按钮不存在(此前 !data 时也不会有按钮)
  await waitFor(() => expect(client.getQueryData(['classroom', 'c1'])).toBeDefined())
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'AI 写评语' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '家长沟通' })).not.toBeInTheDocument()
})

it('header: AI 写评语 needs comment.write and 家长沟通 only ai.class', async () => {
  setup(<ProfileActions profile={profile} />, ['ai.class'])
  fireEvent.click(await screen.findByRole('button', { name: '家长沟通' }))
  expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/ai?tpl=parent&stu=s1')
  expect(screen.queryByRole('button', { name: 'AI 写评语' })).not.toBeInTheDocument()
})

it('header: AI 写评语 jumps to the comment template', async () => {
  setup(<ProfileActions profile={profile} />, ['ai.class', 'comment.write'])
  fireEvent.click(await screen.findByRole('button', { name: 'AI 写评语' }))
  expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/ai?tpl=comment1&stu=s1')
})

it('toggles 给家长看 via setParentVisible and updates the display', async () => {
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [cm({ parent_visible: false })] })
  vi.mocked(commentsApi.setParentVisible).mockResolvedValue(cm({ parent_visible: true }))
  setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  const sw = await screen.findByRole('switch', { name: '给家长看' })
  expect(sw).toHaveAttribute('aria-checked', 'false')
  vi.mocked(commentsApi.list).mockResolvedValue({ items: [cm({ parent_visible: true })] })
  fireEvent.click(sw)
  await waitFor(() => expect(commentsApi.setParentVisible).toHaveBeenCalledWith('m1', true))
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '给家长看' })).toHaveAttribute(
      'aria-checked',
      'true',
    ),
  )
})

it('hints that unconfirmed AI comments are hidden from parents', async () => {
  vi.mocked(commentsApi.list).mockResolvedValue({
    items: [
      cm({ id: 'a', generated_by_ai: true, parent_visible: false }),
      cm({ id: 'b', generated_by_ai: true, parent_visible: true }),
      cm({ id: 'c', generated_by_ai: false, parent_visible: false }),
    ],
  })
  setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  await screen.findAllByRole('listitem')
  expect(screen.getAllByText('AI 生成,需确认后才给家长看')).toHaveLength(1)
})

it('disables share toggle when not allowed', async () => {
  // can_share 由后端按"学生当前在读班的班主任"给出(L69 / L70):为假时开关禁用并说明原因
  vi.mocked(commentsApi.list).mockResolvedValue({
    items: [
      cm({ id: 'past', content: '去年的评语', current_year: false, can_delete: false }),
      cm({ id: 'now', content: '今年的评语', can_share: false }),
    ],
  })
  setup(<CommentsTab profile={profile} />, ['comment.read', 'comment.write'])
  const items = await screen.findAllByRole('listitem')
  // 往年评语:现任班主任能切(can_share 为真),哪怕不能删
  const past = within(items[0]).getByRole('switch', { name: '给家长看' })
  expect(past).toBeEnabled()
  expect(within(items[0]).queryByText('只有孩子现在的班主任能改')).toBeNull()
  const now = within(items[1]).getByRole('switch', { name: '给家长看' })
  expect(now).toBeDisabled()
  expect(within(items[1]).getByText('只有孩子现在的班主任能改')).toBeInTheDocument()
  fireEvent.click(now)
  await act(async () => {})
  expect(commentsApi.setParentVisible).not.toHaveBeenCalled()
})
