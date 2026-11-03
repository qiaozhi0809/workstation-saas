import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { SseHandlers } from './sse'
import { aiApi } from './ai'
import { ApiError } from './client'
import { commentsApi } from './comments'
import { growthApi } from './growth'
import { reviewsApi } from './reviews'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', display_name: 'x' } })
})

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return {
    method: init.method,
    url,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  }
}

/** 把若干文本块作为 SSE 响应体依次吐出 */
function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function recorder() {
  const events: [string, unknown][] = []
  const h: SseHandlers = {
    onMeta: (d) => events.push(['meta', d]),
    onDelta: (t) => events.push(['delta', t]),
    onDone: (d) => events.push(['done', d]),
    onError: (e) => events.push(['error', e]),
  }
  return { events, h }
}

const noop: SseHandlers = { onDelta: () => {} }
const aiReq = { class_id: 'c1', template_id: null, values: {}, text: '你好', mask: true } as const
const growthInput = { type: '表扬', date: '2026-11-02', content: '进步' } as const

const calls: [string, () => Promise<unknown>, string, string, unknown][] = [
  ['ai status', () => aiApi.status(), 'GET', '/api/v1/ai/status', undefined],
  ['ai templates', () => aiApi.templates('c 1'), 'GET', '/api/v1/ai/templates?class_id=c%201', undefined],
  ['ai prompt', () => aiApi.prompt(aiReq), 'POST', '/api/v1/ai/prompt', aiReq],
  ['ai chatPrompt', () => aiApi.chatPrompt('h1'), 'GET', '/api/v1/ai/chats/h1/prompt', undefined],
  ['ai createChat', () => aiApi.createChat(aiReq), 'POST', '/api/v1/ai/chats', aiReq],
  ['ai listChats', () => aiApi.listChats('c1'), 'GET', '/api/v1/ai/chats?class_id=c1', undefined],
  ['ai getChat', () => aiApi.getChat('h1'), 'GET', '/api/v1/ai/chats/h1', undefined],
  ['ai deleteChat', () => aiApi.deleteChat('h1'), 'DELETE', '/api/v1/ai/chats/h1', undefined],
  ['ai reply', () => aiApi.reply('h1', { text: '继续' }, noop), 'POST', '/api/v1/ai/chats/h1/reply',
    { text: '继续' }],
  ['ai runItem', () => aiApi.runItem('h1', 'i1', noop), 'POST', '/api/v1/ai/chats/h1/items/i1/run', {}],
  ['growth list', () => growthApi.list('s1'), 'GET', '/api/v1/students/s1/growth-records', undefined],
  ['growth create', () => growthApi.create('s1', growthInput), 'POST',
    '/api/v1/students/s1/growth-records', growthInput],
  ['growth remove', () => growthApi.remove('g1'), 'DELETE', '/api/v1/growth-records/g1', undefined],
  ['comments list', () => commentsApi.list('s1'), 'GET', '/api/v1/students/s1/comments', undefined],
  ['comments create', () => commentsApi.create('s1', { content: '好', generated_by_ai: false }), 'POST',
    '/api/v1/students/s1/comments', { content: '好', generated_by_ai: false }],
  ['comments bulk', () => commentsApi.bulk('c1', { items: [{ student_id: 's1', content: '好' }],
    generated_by_ai: true }), 'POST', '/api/v1/classes/c1/comments/bulk',
    { items: [{ student_id: 's1', content: '好' }], generated_by_ai: true }],
  ['comments remove', () => commentsApi.remove('m1'), 'DELETE', '/api/v1/comments/m1', undefined],
  ['reviews listForStudent', () => reviewsApi.listForStudent('c1', 'n1'), 'GET',
    '/api/v1/classes/c1/reviews?enrollment_id=n1&limit=40', undefined],
  ['reviews listForStudent limit', () => reviewsApi.listForStudent('c1', 'n1', 10), 'GET',
    '/api/v1/classes/c1/reviews?enrollment_id=n1&limit=10', undefined],
  ['reviews revokeItem', () => reviewsApi.revokeItem('c1', 'r1'), 'POST',
    '/api/v1/classes/c1/reviews/items/r1/revoke', undefined],
]

it.each(calls)('calls the frozen paths: %s', async (_n, run, method, url, body) => {
  await run()
  expect(lastCall()).toEqual({ method, url, body })
})

it('parses SSE events split across chunks', async () => {
  fetchMock.mockResolvedValue(
    sseResponse([
      'event: meta\ndata: {"message_id":"m1"}\n\nevent: del',
      'ta\ndata: {"text":"王小"}\n\nevent: delta\ndata: {"text":"一"}\n\n',
      'event: weird\ndata: {"x":1}\n\nevent: done\r\ndata: {"status":"done"}\r\n\r\n',
    ]),
  )
  const { events, h } = recorder()
  await aiApi.reply('h1', { text: 'hi' }, h)
  expect(events).toEqual([
    ['meta', { message_id: 'm1' }],
    ['delta', '王小'],
    ['delta', '一'],
    ['done', { status: 'done' }],
  ])
})

it('dispatches SSE error events', async () => {
  fetchMock.mockResolvedValue(
    sseResponse(['event: error\ndata: {"code":"AI_QUOTA","message":"额度用完"}\n\n']),
  )
  const { events, h } = recorder()
  await aiApi.runItem('h1', 'i1', h)
  expect(events).toEqual([['error', { code: 'AI_QUOTA', message: '额度用完' }]])
})

it('throws ApiError before streaming starts', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'AI_BUSY', message: '正在生成' } }), { status: 409 }),
  )
  const { events, h } = recorder()
  await expect(aiApi.reply('h1', { regenerate: true }, h)).rejects.toMatchObject({
    name: 'ApiError',
    status: 409,
    code: 'AI_BUSY',
  })
  expect(events).toEqual([])
})

it('refreshes once on 401 then streams', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a2' }), { status: 200 }))
    .mockResolvedValueOnce(sseResponse(['event: delta\ndata: {"text":"好"}\n\n']))
  const { events, h } = recorder()
  await aiApi.reply('h1', { text: 'hi' }, h)
  expect(events).toEqual([['delta', '好']])
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh')
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer a2')
})

it('rejects with AbortError when aborted', async () => {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: delta\ndata: {"text":"a"}\n\n'))
        init.signal?.addEventListener('abort', () =>
          c.error(new DOMException('aborted', 'AbortError')),
        )
      },
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  })
  const ctl = new AbortController()
  const texts: string[] = []
  const p = aiApi.reply('h1', { text: 'hi' }, { onDelta: (t) => { texts.push(t); ctl.abort() } }, ctl.signal)
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(texts).toEqual(['a'])
})

it('normalises a custom abort reason before the response arrives', async () => {
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(init.signal?.reason))
      }),
  )
  const ctl = new AbortController()
  const p = aiApi.reply('h1', { text: 'hi' }, noop, ctl.signal)
  ctl.abort('custom reason')
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
})

it('rejects with AbortError when aborted while read() is pending', async () => {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        init.signal?.addEventListener('abort', () => c.error(init.signal?.reason))
      },
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  })
  const ctl = new AbortController()
  const p = aiApi.reply('h1', { text: 'hi' }, noop, ctl.signal)
  await new Promise((r) => setTimeout(r, 0))
  ctl.abort('stop')
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
})

it('stops dispatching events once a handler aborts mid-chunk', async () => {
  fetchMock.mockResolvedValue(
    sseResponse([
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n',
    ]),
  )
  const ctl = new AbortController()
  const texts: string[] = []
  const p = aiApi.reply('h1', { text: 'hi' }, { onDelta: (t) => { texts.push(t); ctl.abort() } }, ctl.signal)
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(texts).toEqual(['a'])
})

it('parses CRLF split across chunks', async () => {
  fetchMock.mockResolvedValue(
    sseResponse(['event: delta\r\ndata: {"text":"x"}\r\n\r', '\nevent: done\ndata: {"status":"done"}\n\n']),
  )
  const { events, h } = recorder()
  await aiApi.reply('h1', { text: 'hi' }, h)
  expect(events).toEqual([
    ['delta', 'x'],
    ['done', { status: 'done' }],
  ])
})

it('dispatches a trailing event without the final blank line', async () => {
  fetchMock.mockResolvedValue(sseResponse(['event: delta\ndata: {"text":"z"}\n']))
  const { events, h } = recorder()
  await aiApi.reply('h1', { text: 'hi' }, h)
  expect(events).toEqual([['delta', 'z']])
})

it('keeps api() behaviour unchanged', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  await expect(growthApi.remove('g1')).resolves.toBeUndefined()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'RECORD_READONLY', message: '只读' } }), { status: 409 }),
  )
  const err = await growthApi.remove('g1').catch((e) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect(err.code).toBe('RECORD_READONLY')
})
