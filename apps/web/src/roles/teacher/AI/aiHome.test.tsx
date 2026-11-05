import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { examsApi } from '@/shared/api/exams'
import type { AiChat } from '@/shared/types/ai'
import AiHomePage from './AiHomePage'
import { defaultAiMocks, setupAi, statusFixture, templatesFixture } from './aiTestUtils'
import StatusPill from './StatusPill'
import TemplateGrid from './TemplateGrid'

vi.mock('@/shared/api/ai')
vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/exams')

const home = () => setupAi({ element: <AiHomePage /> })
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })
const click = (el: HTMLElement) => fireEvent.click(el)
const box = () => screen.findByLabelText('要做什么')

beforeEach(() => {
  vi.resetAllMocks()
  defaultAiMocks()
})

describe('AiHomePage', () => {
  it('shows provider status or the not-configured hint', async () => {
    home()
    expect(await screen.findByText('王老师,今天想做点什么?')).toBeInTheDocument()
    expect(await screen.findByText('DeepSeek · deepseek-flash')).toBeInTheDocument()
    expect(screen.getByText(/只有点击发送或生成时/)).toBeInTheDocument()
  })

  it('renders nothing for an undefined status and the hint when unconfigured', () => {
    const { rerender, container } = render2(undefined)
    expect(container).toBeEmptyDOMElement()
    rerender(<StatusPill status={{ ...statusFixture, configured: false, provider_label: null }} />)
    const el = screen.getByText('未配置 AI 服务')
    expect(el.closest('[title]')).toHaveAttribute('title', expect.stringContaining('复制提示词'))
  })

  it('sends with Enter, keeps Shift+Enter as newline and ignores composition', async () => {
    vi.mocked(aiApi.createChat).mockResolvedValue({ id: 'c1' } as AiChat)
    home()
    const ta = await box()
    type(ta, '帮我写开场白')
    click(await screen.findByLabelText('班级概况'))
    await screen.findByRole('option', { name: '王小一' })
    type(screen.getByLabelText('+ 学生档案'), 's1')
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229, isComposing: true })
    expect(aiApi.createChat).not.toHaveBeenCalled()
    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() =>
      expect(aiApi.createChat).toHaveBeenCalledWith({
        class_id: 'c1',
        template_id: null,
        values: {},
        text: '帮我写开场白',
        context: { class: true, student_id: 's1', exam_id: null },
        mask: true,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/teacher/ai/c1?go=1'))
  })

  it('M6: a failed send toasts the server message', async () => {
    vi.mocked(aiApi.createChat).mockRejectedValue(new ApiError(429, 'RATE_LIMITED', '请求太频繁了'))
    home()
    type(await box(), '写点什么')
    click(await screen.findByRole('button', { name: '发送' }))
    expect(await screen.findByText('请求太频繁了')).toBeInTheDocument()
  })

  it('disables send while the text is empty', async () => {
    home()
    await box()
    expect(await screen.findByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('opens the copy-prompt dialog when AI is not configured', async () => {
    vi.mocked(aiApi.status).mockResolvedValue({
      ...statusFixture,
      configured: false,
      provider_label: null,
    })
    vi.mocked(aiApi.prompt).mockResolvedValue({
      prompt: '请帮我写发言稿',
      mapping: [{ code: '【学生01】', name: '王小一' }],
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    home()
    type(await box(), '写发言稿')
    click(await screen.findByRole('button', { name: '复制提示词' }))
    const dlg = await screen.findByRole('dialog')
    expect(aiApi.createChat).not.toHaveBeenCalled()
    expect(within(dlg).getByDisplayValue('请帮我写发言稿')).toHaveAttribute('readonly')
    expect(within(dlg).getByText('编号对照表')).toBeInTheDocument()
    expect(within(dlg).getByText('【学生01】 王小一')).toBeInTheDocument()
    click(within(dlg).getByRole('button', { name: '复制提示词' }))
    expect(writeText).toHaveBeenCalledWith('请帮我写发言稿')
    expect(await screen.findByText('已复制')).toBeInTheDocument()
  })

  it('locks the mask checkbox when the school forces it', async () => {
    vi.mocked(aiApi.status).mockResolvedValue({ ...statusFixture, mask_forced: true })
    home()
    const mask = await screen.findByLabelText('隐去学生姓名')
    await waitFor(() => expect(mask).toBeDisabled())
    expect(mask).toBeChecked()
    expect(screen.getByText('学校要求')).toBeInTheDocument()
  })

  it('hides the exam picker without exam.read', async () => {
    setupAi({ element: <AiHomePage />, perms: ['ai.use'] })
    await screen.findByLabelText('+ 学生档案')
    expect(screen.queryByLabelText('+ 考试数据')).not.toBeInTheDocument()
    expect(examsCalled()).toBe(false)
  })

  it('shows the exam picker with exam.read', async () => {
    home()
    expect(await screen.findByLabelText('+ 考试数据')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: '期中考试' })).toBeInTheDocument()
  })

  it('lists templates by category and disables unavailable ones', async () => {
    home()
    const cards = await screen.findAllByRole('button', { name: /说明|仅班主任可用/ })
    expect(cards).toHaveLength(5)
    expect(screen.queryByText('隐藏的模板')).not.toBeInTheDocument()
    const parent = screen.getByRole('button', { name: /家长沟通话术/ })
    expect(parent).toBeDisabled()
    expect(within(parent).getByText('仅班主任可用')).toBeInTheDocument()
    click(screen.getByRole('tab', { name: '家校沟通' }))
    expect(screen.getByRole('button', { name: /家长会发言稿/ })).toBeEnabled()
    expect(screen.queryByText('教案设计')).not.toBeInTheDocument()
  })

  it('calls onPick with the clicked template', async () => {
    const onPick = vi.fn()
    setupAi({ element: <TemplateGrid templates={templatesFixture} onPick={onPick} /> })
    click(await screen.findByRole('button', { name: /教案设计/ }))
    expect(onPick).toHaveBeenCalledWith(templatesFixture.items[0])
  })

  it('lists and deletes recent chats', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    home()
    const link = await screen.findByRole('link', { name: /期中家长会发言稿/ })
    expect(link).toHaveAttribute('href', '/teacher/ai/c1')
    expect(link).toHaveTextContent('11-02 09:30')
    vi.mocked(aiApi.listChats).mockResolvedValue({ items: [] })
    click(screen.getAllByRole('button', { name: '删除对话' })[0])
    expect(window.confirm).toHaveBeenCalledWith('删除这个对话?')
    await waitFor(() => expect(aiApi.deleteChat).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(screen.queryByText('最近对话')).not.toBeInTheDocument())
  })

  it('hides the recent block when there are no chats', async () => {
    vi.mocked(aiApi.listChats).mockResolvedValue({ items: [] })
    home()
    await box()
    await waitFor(() => expect(aiApi.listChats).toHaveBeenCalled())
    expect(screen.queryByText('最近对话')).not.toBeInTheDocument()
  })
})

function examsCalled() {
  return vi.mocked(examsApi.list).mock.calls.length > 0
}
function render2(status: Parameters<typeof StatusPill>[0]['status']) {
  const r = render(<StatusPill status={status} />)
  return r
}
