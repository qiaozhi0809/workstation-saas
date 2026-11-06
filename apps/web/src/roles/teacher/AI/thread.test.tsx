import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiApi } from '@/shared/api/ai'
import { classesApi } from '@/shared/api/classes'
import { commentsApi } from '@/shared/api/comments'
import { ApiError } from '@/shared/api/client'
import { growthApi } from '@/shared/api/growth'
import type { SseHandlers } from '@/shared/api/sse'
import { exportWord } from '@/shared/lib/exportWord'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { AiChat, AiMessage } from '@/shared/types/ai'
import type { ClassPerm } from '@/shared/types/classroom'
import { classFixture, ALL_PERMS } from '../Classroom/pageTestUtils'
import AiThreadPage from './AiThreadPage'
import { defaultAiMocks, setupAi, statusFixture } from './aiTestUtils'

vi.mock('@/shared/api/ai')
vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/comments')
vi.mock('@/shared/api/growth')
vi.mock('@/shared/lib/exportWord')

const msg = (over: Partial<AiMessage> & Pick<AiMessage, 'id' | 'role'>): AiMessage => ({
  content: '',
  status: 'done',
  error: null,
  created_at: '2026-11-02T01:00:00Z',
  ...over,
})
const userMsg = msg({ id: 'm1', role: 'user', content: '帮我写发言稿' })
const replyMsg = msg({ id: 'm2', role: 'assistant', content: '## 开场\n\n**各位家长**好' })

const chatFixture = (over: Partial<AiChat> = {}): AiChat => ({
  id: 't1',
  title: '期中家长会发言稿',
  template_id: 'pmeeting',
  updated_at: '2026-11-02T01:30:00Z',
  class_id: 'c1',
  student_id: null,
  save_as: null,
  mask: true,
  batch_only: false,
  messages: [userMsg, replyMsg],
  items: [],
  ...over,
})

const PERMS: ClassPerm[] = [...ALL_PERMS, 'ai.use', 'comment.write', 'growth.write']
const thread = (entry = '/teacher/ai/t1', perms: ClassPerm[] = PERMS) =>
  setupAi({ element: <AiThreadPage />, path: '/teacher/ai/:chatId', entry, perms })

interface Pending {
  h: SseHandlers
  signal?: AbortSignal
  body: unknown
  resolve(): void
  reject(e: unknown): void
}
/** 把 aiApi.reply 换成"手动驱动"的版本 */
function controlledReply() {
  const calls: Pending[] = []
  vi.mocked(aiApi.reply).mockImplementation(
    (_id, body, h, signal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ h, signal, body, resolve, reject })
        signal?.addEventListener('abort', () => reject(new DOMException('已中止', 'AbortError')))
      }),
  )
  return calls
}
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } })

beforeEach(() => {
  vi.resetAllMocks()
  defaultAiMocks()
  vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture())
})

describe('AiThreadPage streaming', () => {
  it('auto-starts once with go=1 and streams text with a cursor', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ messages: [userMsg] }))
    const calls = controlledReply()
    thread('/teacher/ai/t1?go=1')
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({})
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/ai\/t1$/))
    act(() => calls[0].h.onDelta('第一段'))
    expect(await screen.findByText(/第一段/)).toBeInTheDocument()
    expect(screen.getByText('班级助理 · 正在写…')).toBeInTheDocument()
    expect(screen.getByTestId('stream-cursor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument()
    expect(aiApi.reply).toHaveBeenCalledTimes(1)
  })

  it('N6: offers 重新生成 when the thread ends with an unanswered user message', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ messages: [userMsg] }))
    const calls = controlledReply()
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({})
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument()
  })

  it('throttles renders to about every 100ms', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    vi.useFakeTimers()
    try {
      type(box, '再详细点')
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(calls).toHaveLength(1)
      const seen = () =>
        Array.from(document.querySelectorAll('[data-testid="stream-text"]')).map(
          (e) => e.textContent ?? '',
        )
      act(() => {
        for (let i = 0; i < 20; i++) calls[0].h.onDelta('字')
      })
      const before = seen().filter(Boolean).length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(seen().join('')).toBe('')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(seen().join('')).toBe('字'.repeat(20))
      expect(before).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops, keeps the partial text and marks it stopped after refetch', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再写一版')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('写到一半'))
    await screen.findByText(/写到一半/)
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          replyMsg,
          msg({ id: 'm3', role: 'user', content: '再写一版' }),
          msg({ id: 'm4', role: 'assistant', content: '写到一半', status: 'stopped' }),
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(calls[0].signal?.aborted).toBe(true)
    expect(screen.getByText(/写到一半/)).toBeInTheDocument()
    expect(await screen.findByText('(已停止)', {}, { timeout: 2500 })).toBeInTheDocument()
    expect(screen.queryByTestId('stream-cursor')).not.toBeInTheDocument()
    expect(screen.getByText('写到一半')).toBeInTheDocument()
  })

  it('shows the error box with retry and copy-prompt', async () => {
    const calls = controlledReply()
    vi.mocked(aiApi.chatPrompt).mockResolvedValue({ prompt: '请写发言稿', mapping: [] })
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => {
      calls[0].h.onError?.({ code: 'AI_KEY_INVALID', message: '密钥无效' })
      calls[0].resolve()
    })
    const err = await screen.findByText('密钥无效')
    expect(err.closest('[data-testid="error-box"]')).toHaveClass('border-destructive')
    fireEvent.click(screen.getByRole('button', { name: '改为复制提示词' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByDisplayValue('请写发言稿')).toBeInTheDocument()
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ text: '再来' })
    expect(aiApi.chatPrompt).toHaveBeenCalled()
  })

  it('retries a persisted error reply with regenerate', async () => {
    const calls = controlledReply()
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          msg({ id: 'm2', role: 'assistant', status: 'error', error: '密钥无效' }),
        ],
      }),
    )
    thread()
    expect(await screen.findByText('密钥无效')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ regenerate: true })
  })

  it('retries an unanswered user message with an empty body', async () => {
    const calls = controlledReply()
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ messages: [userMsg] }))
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => {
      calls[0].h.onError?.({ code: 'X', message: '出错了' })
      calls[0].resolve()
    })
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({})
  })

  it('reports a stream that ends silently as a broken connection', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => {
      calls[0].h.onDelta('半截')
      calls[0].resolve()
    })
    expect(await screen.findByText('连接中断了,可以点「重试」')).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(aiApi.getChat).mock.calls.length).toBeGreaterThan(1))
  })

  it('toasts when the chat is busy', async () => {
    vi.mocked(aiApi.reply).mockRejectedValue(new ApiError(409, 'AI_BUSY', 'busy'))
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('这个对话正在生成,请稍候')).toBeInTheDocument()
  })

  it('shows the not-configured state', async () => {
    vi.mocked(aiApi.reply).mockRejectedValue(new ApiError(503, 'AI_NOT_CONFIGURED', 'x'))
    vi.mocked(aiApi.status).mockResolvedValue({
      ...statusFixture,
      configured: false,
      provider_label: null,
    })
    vi.mocked(aiApi.chatPrompt).mockResolvedValue({ prompt: '提示词全文', mapping: [] })
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(
      await screen.findByText('学校还没有配置 AI 服务,请联系管理员;可以先复制提示词'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }))
    expect(await screen.findByDisplayValue('提示词全文')).toBeInTheDocument()
  })

  it('aborts the in-flight request on unmount', async () => {
    const calls = controlledReply()
    const { unmount } = thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    unmount()
    await waitFor(() => expect(calls[0].signal?.aborted).toBe(true))
  })
})

describe('AiThreadPage toolbar and composer', () => {
  const saveChat = () => chatFixture({ save_as: 'comment', student_id: 's1' })

  it('saves a reply as a comment and to growth records', async () => {
    const long = `# 标题\n\n**${'好'.repeat(300)}**`
    vi.mocked(aiApi.getChat).mockResolvedValue({
      ...saveChat(),
      messages: [userMsg, msg({ id: 'm2', role: 'assistant', content: long })],
    })
    vi.mocked(commentsApi.create).mockResolvedValue({} as never)
    vi.mocked(growthApi.create).mockResolvedValue({} as never)
    const { client } = thread()
    const spy = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(await screen.findByRole('button', { name: '保存为评语' }))
    await waitFor(() =>
      expect(commentsApi.create).toHaveBeenCalledWith('s1', {
        content: long,
        generated_by_ai: true,
      }),
    )
    expect(await screen.findByText('已保存到档案的评语')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['comments', 's1'] }))
    fireEvent.click(screen.getByRole('button', { name: '记到成长记录' }))
    await waitFor(() => expect(growthApi.create).toHaveBeenCalled())
    const [sid, body] = vi.mocked(growthApi.create).mock.calls[0]
    expect(sid).toBe('s1')
    expect(body.type).toBe('其他')
    expect(body.date).toBe('2026-11-02')
    expect(body.content).not.toMatch(/[#*]/)
    expect(body.content.length).toBeLessThanOrEqual(200)
    expect(await screen.findByText('已记到成长记录')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['growth', 's1'] }))
  })

  it('hides save buttons without permission', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(saveChat())
    thread('/teacher/ai/t1', ['ai.use'])
    await screen.findByRole('button', { name: '复制' })
    expect(screen.queryByRole('button', { name: '保存为评语' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '记到成长记录' })).not.toBeInTheDocument()
  })

  it('hides 保存为评语 when save_as is not comment', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ student_id: 's1' }))
    thread()
    await screen.findByRole('button', { name: '记到成长记录' })
    expect(screen.queryByRole('button', { name: '保存为评语' })).not.toBeInTheDocument()
  })

  it('sends follow-ups with Enter and regenerates the last reply', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '  再短一点  ')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229, isComposing: true })
    expect(aiApi.reply).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ text: '再短一点' })
    expect(await screen.findByText('再短一点')).toBeInTheDocument()
    act(() => calls[0].h.onDelta('新回复'))
    await screen.findByText(/新回复/)
    expect(screen.getByText('开场')).toBeInTheDocument()
    act(() => {
      calls[0].h.onDone?.({ status: 'done' })
      calls[0].resolve()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument(),
    )
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ regenerate: true })
  })

  it('accepts a new request right after a stream ends and clears the box only when accepted', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '第一问')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    vi.mocked(aiApi.getChat).mockReturnValue(new Promise(() => {}))
    act(() => {
      calls[0].h.onDone?.({ status: 'done' })
      calls[0].resolve()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument(),
    )
    type(box, '第二问')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ text: '第二问' })
    expect(box).toHaveValue('')
  })

  it('exports the whole chat and a single message to Word', async () => {
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '导出 Word' }))
    expect(exportWord).toHaveBeenCalledWith(
      '期中家长会发言稿',
      '**老师:**帮我写发言稿\n\n---\n\n## 开场\n\n**各位家长**好',
    )
    fireEvent.click(screen.getByRole('button', { name: '导出 Word(这一条)' }))
    expect(exportWord).toHaveBeenLastCalledWith('期中家长会发言稿', replyMsg.content)
  })

  it('deletes after confirmation and returns home', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(aiApi.deleteChat).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/ai$/))
  })

  it('batch_only chats have no composer and no regenerate', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ batch_only: true }))
    thread()
    await screen.findByRole('button', { name: '复制' })
    expect(screen.queryByLabelText('继续追问…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument()
  })

  it('only autoscrolls when near the bottom', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    const sc = screen.getByTestId('thread-scroll')
    let top = 100
    Object.defineProperty(sc, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(sc, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(sc, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v
      },
      configurable: true,
    })
    type(box, '再来')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('甲'))
    await screen.findByText(/甲/)
    expect(top).toBe(100)
    top = 560
    act(() => calls[0].h.onDelta('乙'))
    await screen.findByText(/甲乙/)
    expect(top).toBe(1000)
  })
})

describe('AiThreadPage final-review fixes', () => {
  it('F2: a refetch landing mid-stream does not duplicate the question or add a second assistant bubble', async () => {
    const calls = controlledReply()
    const { client } = thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '追问内容')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('正在写'))
    await screen.findByText(/正在写/)
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          replyMsg,
          msg({ id: 'm3', role: 'user', content: '追问内容' }),
          msg({ id: 'm4', role: 'assistant', content: '', status: 'streaming' }),
        ],
      }),
    )
    const before = vi.mocked(aiApi.getChat).mock.calls.length
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['ai-chat', 't1'] })
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(vi.mocked(aiApi.getChat).mock.calls.length).toBeGreaterThan(before)
    expect(screen.getAllByText('追问内容')).toHaveLength(1)
    // 2 条历史 + 老师追问 + 1 个流式气泡
    expect(screen.getByTestId('thread-scroll').children).toHaveLength(4)
    expect(screen.getAllByTestId('stream-text')).toHaveLength(1)
  })

  it('F3: Enter with keyCode 229 (Safari IME) does not send', async () => {
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '输入中')
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(aiApi.reply).not.toHaveBeenCalled()
    expect(box).toHaveValue('输入中')
  })

  it('F5: keeps the typed follow-up when the request never started (AI_BUSY)', async () => {
    vi.mocked(aiApi.reply).mockRejectedValue(new ApiError(409, 'AI_BUSY', 'busy'))
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '我的追问')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('这个对话正在生成,请稍候')).toBeInTheDocument()
    await waitFor(() => expect(box).toHaveValue('我的追问'))
  })

  it('F6: only the last message offers 重试', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          msg({ id: 'e1', role: 'assistant', status: 'error', error: '第一次失败' }),
          msg({ id: 'm3', role: 'user', content: '再来' }),
          msg({ id: 'e2', role: 'assistant', status: 'error', error: '第二次失败' }),
        ],
      }),
    )
    thread()
    await screen.findByText('第二次失败')
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '改为复制提示词' })).toHaveLength(2)
    const older = screen.getByText('第一次失败').closest('[data-testid="error-box"]') as HTMLElement
    expect(within(older).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('M2: whole-chat export only includes finished assistant messages', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          replyMsg,
          msg({ id: 'm3', role: 'user', content: '再来' }),
          msg({ id: 'm4', role: 'assistant', status: 'error', error: '失败' }),
          msg({ id: 'm5', role: 'assistant', content: '半截', status: 'stopped' }),
          msg({ id: 'm6', role: 'assistant', content: '', status: 'streaming' }),
        ],
      }),
    )
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '导出 Word' }))
    expect(exportWord).toHaveBeenCalledWith(
      '期中家长会发言稿',
      '**老师:**帮我写发言稿\n\n---\n\n## 开场\n\n**各位家长**好\n\n---\n\n**老师:**再来\n\n---\n\n半截',
    )
  })

  it('M5: retrying a failed regenerate resends regenerate', async () => {
    const calls = controlledReply()
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => {
      calls[0].h.onError?.({ code: 'X', message: '重新生成失败' })
      calls[0].resolve()
    })
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ regenerate: true })
  })

  it('M5: retrying a failed follow-up after a done reply resends the text', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '换个说法')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => {
      calls[0].h.onError?.({ code: 'X', message: '追问失败' })
      calls[0].resolve()
    })
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].body).toEqual({ text: '换个说法' })
  })

  it('F1: 保存为评语 / 记到成长记录 are disabled after success', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({ save_as: 'comment', student_id: 's1' }),
    )
    vi.mocked(commentsApi.create).mockResolvedValue({} as never)
    vi.mocked(growthApi.create).mockResolvedValue({} as never)
    thread()
    fireEvent.click(await screen.findByRole('button', { name: '保存为评语' }))
    const done = await screen.findByRole('button', { name: '已保存' })
    expect(done).toBeDisabled()
    fireEvent.click(done)
    fireEvent.click(screen.getByRole('button', { name: '记到成长记录' }))
    const grown = await screen.findByRole('button', { name: '已记录' })
    expect(grown).toBeDisabled()
    expect(commentsApi.create).toHaveBeenCalledTimes(1)
    expect(growthApi.create).toHaveBeenCalledTimes(1)
  })
})

describe('AiThreadPage L17', () => {
  it('a 重试 rejected while another reply is streaming does not duplicate the question', async () => {
    const calls = controlledReply()
    const failed = msg({ id: 'e1', role: 'assistant', status: 'error', error: '上次失败' })
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ messages: [userMsg, failed] }))
    const { client } = thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '追问内容')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('正在写'))
    await screen.findByText(/正在写/)
    // 服务端已把追问和流式占位落库,重新拉取到了
    vi.mocked(aiApi.getChat).mockResolvedValue(
      chatFixture({
        messages: [
          userMsg,
          failed,
          msg({ id: 'm3', role: 'user', content: '追问内容' }),
          msg({ id: 'm4', role: 'assistant', content: '', status: 'streaming' }),
        ],
      }),
    )
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['ai-chat', 't1'] })
      await new Promise((r) => setTimeout(r, 30))
    })
    // 旧错误上的"重试"此时会被拒(上一次生成还没结束):被拒的请求不能改变页面上显示哪些消息,
    // 流继续刷新(重新渲染)后也不能
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(calls).toHaveLength(1)
    act(() => calls[0].h.onDelta('继续写'))
    await screen.findByText(/正在写继续写/)
    expect(screen.getAllByText('追问内容')).toHaveLength(1)
    expect(screen.getAllByTestId('stream-text')).toHaveLength(1)
    expect(screen.getByTestId('thread-scroll').children).toHaveLength(4)
  })

  it('a follow-up sent before the previous refetch lands keeps the previous exchange visible', async () => {
    const calls = controlledReply()
    thread()
    const box = await screen.findByLabelText('继续追问…')
    type(box, '第一问')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('第一答'))
    await screen.findByText(/第一答/)
    // 第一次生成结束,但服务端重取还没回来
    let release!: (c: AiChat) => void
    vi.mocked(aiApi.getChat).mockImplementation(
      () =>
        new Promise<AiChat>((r) => {
          release = r
        }),
    )
    act(() => {
      calls[0].h.onDone?.({ status: 'done' })
      calls[0].resolve()
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument(),
    )
    // 趁重取没落地再追问一次
    type(box, '第二问')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls).toHaveLength(2))
    // 第一次重取这时才落地,带着第一组问答:它们应当立刻可见,而不是等第二次生成结束
    await act(async () => {
      release(
        chatFixture({
          messages: [
            userMsg,
            replyMsg,
            msg({ id: 'm3', role: 'user', content: '第一问' }),
            msg({ id: 'm4', role: 'assistant', content: '第一答' }),
          ],
        }),
      )
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByText('第一问')).toBeInTheDocument()
    expect(screen.getByText('第一答')).toBeInTheDocument()
    expect(screen.getAllByText('第二问')).toHaveLength(1)
  })

  it('names the per-message export button with its visible text', async () => {
    thread()
    const header = await screen.findByRole('button', { name: '导出 Word' })
    expect(header).toHaveTextContent('导出 Word')
    const single = screen.getByRole('button', { name: '导出 Word(这一条)' })
    expect(single).toHaveTextContent('导出 Word')
    fireEvent.click(single)
    expect(exportWord).toHaveBeenLastCalledWith('期中家长会发言稿', replyMsg.content)
  })

  it('a chat of another class never flashes 找不到 while the class list is still loading', async () => {
    // 班级列表比对话数据晚到:ClassGate 先等列表,页面不应在中间闪出"找不到这个对话"
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ class_id: 'c2' }))
    let release!: (v: { items: (typeof classFixture)[] }) => void
    vi.mocked(classesApi.mine).mockImplementation(
      () =>
        new Promise((r) => {
          release = r
        }),
    )
    thread()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.queryByText('找不到这个对话')).not.toBeInTheDocument()
    await act(async () => {
      release({ items: [classFixture, { ...classFixture, id: 'c2', name: '四年一班' }] })
    })
    expect(await screen.findByText('这个对话属于其他班级')).toBeInTheDocument()
    expect(screen.queryByText('找不到这个对话')).not.toBeInTheDocument()
  })
})

describe('AiThreadPage routing guards', () => {
  it('offers to switch class for a chat of another class', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ class_id: 'c2' }))
    vi.mocked(classesApi.mine).mockResolvedValue({
      items: [classFixture, { ...classFixture, id: 'c2', name: '四年一班' }],
    })
    thread()
    expect(await screen.findByText('这个对话属于其他班级')).toBeInTheDocument()
    expect(screen.queryByLabelText('继续追问…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '切换到四年一班' }))
    expect(useTeacherStore.getState().classId).toBe('c2')
  })

  it('shows not-found when the chat belongs to an unknown class', async () => {
    vi.mocked(aiApi.getChat).mockResolvedValue(chatFixture({ class_id: 'zz' }))
    thread()
    expect(await screen.findByText('找不到这个对话')).toBeInTheDocument()
  })

  it('shows not-found with a link home on NOT_FOUND', async () => {
    vi.mocked(aiApi.getChat).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'))
    thread()
    expect(await screen.findByText('找不到这个对话')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '← 返回 AI 助手' }))
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/ai$/))
  })
})
