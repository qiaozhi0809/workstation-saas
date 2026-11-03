import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { commentsApi } from '@/shared/api/comments'
import type { SseHandlers } from '@/shared/api/sse'
import type { AiBatchItem, AiChat } from '@/shared/types/ai'
import type { ClassPerm } from '@/shared/types/classroom'
import { ALL_PERMS } from '../Classroom/pageTestUtils'
import AiThreadPage from './AiThreadPage'
import { defaultAiMocks, setupAi } from './aiTestUtils'

vi.mock('@/shared/api/ai')
vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/exams')
vi.mock('@/shared/api/comments')

const item = (n: number, over: Partial<AiBatchItem> = {}): AiBatchItem => ({
  id: `i${n}`, student_id: `s${n}`, student_name: `学生${n}`, note: null,
  status: 'wait', content: '', error: null, ...over,
})
const chatFixture = (items: AiBatchItem[], over: Partial<AiChat> = {}): AiChat => ({
  id: 'b1', title: '期末评语', template_id: 'comments', updated_at: '2026-11-02T01:30:00Z',
  class_id: 'c1', student_id: null, save_as: 'comment', mask: true, batch_only: true,
  messages: [], items, ...over,
})
const PERMS: ClassPerm[] = [...ALL_PERMS, 'ai.use', 'comment.write']
const page = (entry = '/teacher/ai/b1', perms: ClassPerm[] = PERMS) =>
  setupAi({ element: <AiThreadPage />, path: '/teacher/ai/:chatId', entry, perms })

interface Run { itemId: string; h: SseHandlers; signal?: AbortSignal; resolve(): void; reject(e: unknown): void }
function controlledRun() {
  const calls: Run[] = []
  vi.mocked(aiApi.runItem).mockImplementation((_c, itemId, h, signal) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ itemId, h, signal, resolve, reject })
      signal?.addEventListener('abort', () => reject(new DOMException('已中止', 'AbortError')))
    }))
  return calls
}
/** 服务端状态 */
let server: AiBatchItem[]
const setServer = (items: AiBatchItem[]) => { server = items }
const finish = (c: Run, content: string) => {
  setServer(server.map((i) => (i.id === c.itemId ? { ...i, status: 'done', content } : i)))
  act(() => { c.h.onDone?.({} as never); c.resolve() })
}

beforeEach(() => {
  vi.resetAllMocks()
  defaultAiMocks()
  setServer([item(1), item(2), item(3)])
  vi.mocked(aiApi.getChat).mockImplementation(async () => chatFixture(server))
})

describe('BatchView', () => {
  it('runs items one at a time in order and updates progress', async () => {
    const calls = controlledRun()
    page()
    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getByText('完成 0/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].itemId).toBe('i1')
    act(() => calls[0].h.onDelta('学生一的评语'))
    expect(await screen.findByText(/学生一的评语/)).toBeInTheDocument()
    expect(screen.getAllByText('生成中')).toHaveLength(1)
    expect(screen.getAllByText('排队中')).toHaveLength(2)
    expect(calls).toHaveLength(1)
    finish(calls[0], '学生一的评语')
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].itemId).toBe('i2')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    finish(calls[1], '二')
    await waitFor(() => expect(calls).toHaveLength(3))
    finish(calls[2], '三')
    await screen.findByText('完成 3/3')
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续生成' })).not.toBeInTheDocument()
  })

  it('continues after a failed item and retries failures on continue', async () => {
    const calls = controlledRun()
    setServer([item(1), item(2)])
    page()
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    setServer([item(1, { status: 'err', error: '额度不足' }), item(2)])
    act(() => { calls[0].h.onError?.({ code: 'X', message: '额度不足' }); calls[0].resolve() })
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].itemId).toBe('i2')
    finish(calls[1], '二')
    expect(await screen.findByText('额度不足')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '继续生成' }))
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].itemId).toBe('i1')
    expect(calls).toHaveLength(3)
  })

  it('stops the current item and leaves the rest waiting', async () => {
    const calls = controlledRun()
    page()
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].h.onDelta('写到一半'))
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))
    expect(calls[0].signal?.aborted).toBe(true)
    expect(await screen.findByRole('button', { name: '开始生成' }, { timeout: 2500 })).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(screen.getAllByText('排队中')).toHaveLength(3)
  })

  it('saves all finished comments in one request', async () => {
    setServer([item(1, { status: 'done', content: '甲' }), item(2, { status: 'done', content: '乙' }), item(3)])
    vi.mocked(commentsApi.bulk).mockResolvedValue({ created: 2 })
    page()
    fireEvent.click(await screen.findByRole('button', { name: '全部保存到档案' }))
    await waitFor(() => expect(commentsApi.bulk).toHaveBeenCalledWith('c1', {
      items: [{ student_id: 's1', content: '甲' }, { student_id: 's2', content: '乙' }],
      generated_by_ai: true,
    }))
    expect(await screen.findByText('已保存 2 条评语')).toBeInTheDocument()
  })

  it('saves a single finished item to the archive', async () => {
    setServer([item(1, { status: 'done', content: '甲' })])
    vi.mocked(commentsApi.create).mockResolvedValue({} as never)
    page()
    const card = (await screen.findByText('学生1')).closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '保存到档案' }))
    await waitFor(() => expect(commentsApi.create).toHaveBeenCalledWith('s1', { content: '甲', generated_by_ai: true }))
    expect(await screen.findByText('已保存到档案的评语')).toBeInTheDocument()
  })

  it('hides save buttons without comment.write', async () => {
    setServer([item(1, { status: 'done', content: '甲' })])
    page('/teacher/ai/b1', [...ALL_PERMS.filter((p) => p !== 'comment.write'), 'ai.use'])
    await screen.findByText('学生1')
    expect(screen.queryByRole('button', { name: '全部保存到档案' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存到档案' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('shows the regress note for parent batches and no save buttons', async () => {
    setServer([item(1, { status: 'done', content: '甲', note: '退步 6 名' })])
    vi.mocked(aiApi.getChat).mockImplementation(async () => chatFixture(server, { save_as: null }))
    page()
    expect(await screen.findByText('退步 6 名')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全部保存到档案' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存到档案' })).not.toBeInTheDocument()
  })

  it('auto-starts once with go=1 and strips it from the url', async () => {
    const calls = controlledRun()
    page('/teacher/ai/b1?go=1')
    await waitFor(() => expect(calls).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent(/^\/teacher\/ai\/b1$/))
    expect(calls).toHaveLength(1)
  })

  it('toasts when busy and shows the not-configured notice', async () => {
    vi.mocked(aiApi.runItem).mockRejectedValueOnce(new ApiError(409, 'AI_BUSY', 'busy'))
    page()
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    expect(await screen.findByText('这个对话正在生成,请稍候')).toBeInTheDocument()
    vi.mocked(aiApi.runItem).mockRejectedValueOnce(new ApiError(503, 'AI_NOT_CONFIGURED', 'x'))
    vi.mocked(aiApi.chatPrompt).mockResolvedValue({ prompt: '提示词全文', mapping: [] })
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    expect(await screen.findByText('学校还没有配置 AI 服务,请联系管理员;可以先复制提示词')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }))
    expect(await screen.findByDisplayValue('提示词全文')).toBeInTheDocument()
  })

  it('reports a stream that ends silently and stops the loop', async () => {
    const calls = controlledRun()
    page()
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => calls[0].resolve())
    expect(await screen.findByText('连接中断了,可以点「继续生成」')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })
})
