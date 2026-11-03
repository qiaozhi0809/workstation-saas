import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/stores/auth'
import { examsApi } from '@/shared/api/exams'
import type { AiChat } from '@/shared/types/ai'
import AiHomePage from './AiHomePage'
import {
  defaultAiMocks, examsFixture, formTemplateFixture, hiddenTemplateFixture, setupAi, statusFixture,
  templatesFixture,
} from './aiTestUtils'
import TemplateForm from './TemplateForm'

vi.mock('@/shared/api/ai')
vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/exams')

const click = (el: HTMLElement) => fireEvent.click(el)
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })
const onClose = vi.fn()

const form = (status = statusFixture, initial?: Record<string, never>) =>
  setupAi({
    element: <TemplateForm template={formTemplateFixture} classId="c1" status={status} initial={initial} onClose={onClose} />,
  })

beforeEach(() => {
  vi.resetAllMocks()
  defaultAiMocks()
  vi.mocked(examsApi.list).mockResolvedValue({ items: examsFixture } as never)
  vi.mocked(aiApi.templates).mockResolvedValue({
    ...templatesFixture,
    items: [...templatesFixture.items, formTemplateFixture, hiddenTemplateFixture],
  })
})

describe('TemplateForm', () => {
  it('renders every field type with defaults', async () => {
    form()
    expect(await screen.findByRole('dialog', { name: '成绩分析' })).toBeInTheDocument()
    expect(screen.getByLabelText('课题')).toHaveValue('')
    expect(screen.getByLabelText('补充说明')).toHaveValue('')
    expect(screen.getByRole('button', { name: '温和' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '严肃' })).toHaveAttribute('aria-pressed', 'false')
    click(screen.getByRole('button', { name: '鼓励' }))
    expect(screen.getByRole('button', { name: '鼓励' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '温和' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('附带建议')).toBeChecked()
    expect(await screen.findByRole('option', { name: '王小一' })).toBeInTheDocument()
    expect(screen.getByLabelText('学生')).toHaveValue('')
    expect(screen.getByText('已选 0 人')).toBeInTheDocument()
    // 考试:新 → 旧,默认第一场;对比考试默认前一场,并有「不对比」
    await waitFor(() => expect(screen.getByLabelText('考试')).toHaveValue('x3'))
    expect(screen.getByLabelText('对比考试')).toHaveValue('x2')
    expect(within(screen.getByLabelText('对比考试')).getByRole('option', { name: '不对比' })).toBeInTheDocument()
    // 必填项标 *
    expect(screen.getAllByText('*')).toHaveLength(3)
    // 隐去姓名默认勾选
    expect(screen.getByLabelText('隐去学生姓名')).toBeChecked()
    expect(screen.getByText('学生姓名会先换成编号再发送,结果回来后自动换回')).toBeInTheDocument()
  })

  it('selects all and none in the students grid', async () => {
    form()
    const group = await screen.findByRole('group', { name: '同学' })
    await within(group).findByLabelText('王小一')
    click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByText('已选 3 人')).toBeInTheDocument()
    expect(within(group).getByLabelText('李小二')).toBeChecked()
    click(screen.getByRole('button', { name: '全不选' }))
    expect(screen.getByText('已选 0 人')).toBeInTheDocument()
    click(within(group).getByLabelText('张小三'))
    expect(screen.getByText('已选 1 人')).toBeInTheDocument()
  })

  it('recomputes the exam0 default unless the teacher chose it', async () => {
    form()
    await waitFor(() => expect(screen.getByLabelText('考试')).toHaveValue('x3'))
    type(screen.getByLabelText('考试'), 'x1')
    expect(screen.getByLabelText('对比考试')).toHaveValue('')
    type(screen.getByLabelText('考试'), 'x2')
    expect(screen.getByLabelText('对比考试')).toHaveValue('x1')
    type(screen.getByLabelText('对比考试'), 'x3')
    type(screen.getByLabelText('考试'), 'x1')
    expect(screen.getByLabelText('对比考试')).toHaveValue('x3')
  })

  it('copies the prompt even when AI is not configured', async () => {
    vi.mocked(aiApi.prompt).mockResolvedValue({ prompt: '请分析成绩', mapping: [] })
    form({ ...statusFixture, configured: false, provider_label: null })
    const start = await screen.findByRole('button', { name: '开始生成' })
    expect(start).toBeDisabled()
    expect(start).toHaveAttribute('title', expect.stringContaining('未配置'))
    type(screen.getByLabelText('课题'), '期中复盘')
    await screen.findByRole('option', { name: '王小一' })
    type(screen.getByLabelText('学生'), 's2')
    click(within(screen.getByRole('group', { name: '同学' })).getByLabelText('王小一'))
    await waitFor(() => expect(screen.getByLabelText('考试')).toHaveValue('x3'))
    click(screen.getByRole('button', { name: '复制提示词' }))
    expect(await screen.findByLabelText('提示词内容')).toHaveValue('请分析成绩')
    expect(aiApi.prompt).toHaveBeenCalledWith({
      class_id: 'c1', template_id: 'report', mask: true,
      values: {
        topic: '期中复盘', note: '', tone: '温和', tips: true, who: 's2', group: ['s1'], cur: 'x3', prev: 'x2',
      },
    })
  })

  it('starts a chat and navigates with go=1', async () => {
    vi.mocked(aiApi.createChat).mockResolvedValue({ id: 'chat9' } as AiChat)
    form({ ...statusFixture, mask_forced: true })
    const mask = await screen.findByLabelText('隐去学生姓名')
    expect(mask).toBeChecked()
    expect(mask).toBeDisabled()
    expect(screen.getByText('学校要求')).toBeInTheDocument()
    type(screen.getByLabelText('课题'), '期中复盘')
    await waitFor(() => expect(screen.getByLabelText('考试')).toHaveValue('x3'))
    type(screen.getByLabelText('对比考试'), '')
    click(screen.getByRole('button', { name: '开始生成' }))
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/teacher/ai/chat9?go=1'))
    expect(aiApi.createChat).toHaveBeenCalledWith(expect.objectContaining({
      template_id: 'report', mask: true, values: expect.objectContaining({ prev: null, cur: 'x3', who: '' }),
    }))
  })

  it('shows field errors from the server', async () => {
    vi.mocked(aiApi.createChat).mockRejectedValue(
      new ApiError(422, 'AI_FIELD_INVALID', '请填写课题', { field: 'topic' }),
    )
    form()
    click(await screen.findByRole('button', { name: '开始生成' }))
    const err = await screen.findByText('请填写课题')
    expect(err).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText('课题')).toHaveAttribute('aria-invalid', 'true')
    type(screen.getByLabelText('课题'), '期中')
    expect(screen.queryByText('请填写课题')).toBeNull()
  })

  it('toasts when no student regressed and on other errors', async () => {
    vi.mocked(aiApi.createChat)
      .mockRejectedValueOnce(new ApiError(422, 'AI_NO_TARGETS', 'x'))
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '服务开小差了'))
    form()
    click(await screen.findByRole('button', { name: '开始生成' }))
    expect(await screen.findByText('这两场考试之间没有退步 5 名及以上的同学')).toBeInTheDocument()
    click(screen.getByRole('button', { name: '开始生成' }))
    expect(await screen.findByText('服务开小差了')).toBeInTheDocument()
  })
})

describe('template entry', () => {
  const open = (search: string) =>
    setupAi({ element: <AiHomePage />, entry: `/teacher/ai${search}` })

  it('opens a template from the grid', async () => {
    open('')
    click(await screen.findByRole('button', { name: /教案设计/ }))
    expect(await screen.findByRole('dialog', { name: '教案设计' })).toBeInTheDocument()
  })

  it('opens a prefilled template from ?tpl=&stu=', async () => {
    open('?tpl=comment1&stu=s1&exam=x2&vs=x1&keep=1')
    const dlg = await screen.findByRole('dialog', { name: '个人评语' })
    await waitFor(() => expect(within(dlg).getByLabelText('学生')).toHaveValue('s1'))
    expect(within(dlg).getByLabelText('考试')).toHaveValue('x2')
    expect(within(dlg).getByLabelText('对比考试')).toHaveValue('x1')
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/teacher/ai?keep=1'))
  })

  it('fills students with [stu] for a students field', async () => {
    open('?tpl=report&stu=s3')
    const dlg = await screen.findByRole('dialog', { name: '成绩分析' })
    expect(await within(dlg).findByLabelText('张小三')).toBeChecked()
    expect(within(dlg).getByLabelText('学生')).toHaveValue('s3')
    expect(within(dlg).getByText('已选 1 人')).toBeInTheDocument()
  })

  it('refuses an unavailable template from a deep link', async () => {
    open('?tpl=parent&stu=s1')
    // 卡片上一份原因,提示条上一份
    await waitFor(() => expect(screen.getAllByText('仅班主任可用')).toHaveLength(2))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/ai$/))
  })

  it('ignores an unknown template id', async () => {
    open('?tpl=nope')
    await screen.findByText('王老师,今天想做点什么?')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('AI status failure', () => {
  it('shows a retry notice when the status query fails', async () => {
    vi.mocked(aiApi.status).mockRejectedValueOnce(new Error('boom'))
    setupAi({ element: <AiHomePage /> })
    expect(await screen.findByText('AI 状态加载失败')).toBeInTheDocument()
    click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByText('AI 状态加载失败')).toBeNull())
    expect(await screen.findByText('DeepSeek · deepseek-flash')).toBeInTheDocument()
  })
})

describe('home greeting', () => {
  it.each([
    ['王', '王老师,今天想做点什么?'],
    ['王老师', '王老师,今天想做点什么?'],
    ['', '老师您好,今天想做点什么?'],
  ])('greets display name %j as %s', async (display_name, text) => {
    // 先让用户为空,避免 setupAi 的默认姓名先渲染
    setupAi({ element: <AiHomePage /> })
    act(() => useAuthStore.setState({ user: { id: 'u1', display_name } }))
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})
