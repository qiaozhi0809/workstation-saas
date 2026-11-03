import { authedFetch, toApiError } from './client'

export interface SseHandlers {
  onMeta?(d: { message_id?: string; item_id?: string }): void
  onDelta(text: string): void
  onDone?(d: { status: 'done' | 'stopped' }): void
  onError?(e: { code: string; message: string }): void
}

function dispatch(block: string, h: SseHandlers): void {
  let name = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!name || data.length === 0) return
  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch {
    return
  }
  if (name === 'meta') h.onMeta?.(payload as { message_id?: string; item_id?: string })
  else if (name === 'delta') h.onDelta((payload as { text: string }).text)
  else if (name === 'done') h.onDone?.(payload as { status: 'done' | 'stopped' })
  else if (name === 'error') h.onError?.(payload as { code: string; message: string })
}

/**
 * POST 并逐个分发 SSE 事件。响应不是 2xx 时抛 ApiError（此时还没开始推流）；
 * signal 中止时抛 name='AbortError' 的错误。未知事件名忽略。
 */
export async function streamSSE(
  path: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await authedFetch('POST', path, { body, signal })
  if (!res.ok) throw await toApiError(res)
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const flush = (final: boolean) => {
    buf = buf.replace(/\r\n/g, '\n')
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      dispatch(buf.slice(0, i), handlers)
      buf = buf.slice(i + 2)
    }
    if (final && buf.trim()) {
      dispatch(buf, handlers)
      buf = ''
    }
  }
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('已中止', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // 防止 \r 与 \n 被切在两个 chunk 之间：尾部孤立的 \r 留到下一轮
      if (buf.endsWith('\r')) {
        const keep = buf.slice(-1)
        buf = buf.slice(0, -1)
        flush(false)
        buf += keep
      } else flush(false)
    }
    buf += decoder.decode()
    flush(true)
  } catch (e) {
    if (signal?.aborted && !(e instanceof DOMException && e.name === 'AbortError')) {
      throw new DOMException('已中止', 'AbortError')
    }
    throw e
  } finally {
    reader.cancel().catch(() => {})
  }
}
