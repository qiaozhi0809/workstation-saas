// 假的 OpenAI 兼容服务商,只给 E2E 用,绝不连外网。只用 Node 内置 http。
// POST /v1/chat/completions 记下请求体并按 SSE 回(最后一条用户消息含“出错”则回 401);GET /last 返回最近一次请求体;POST /reset 清空。
import http from 'node:http'

const PORT = Number(process.env.FAKE_LLM_PORT ?? 18089)
let last = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const send = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
const delta = (res, text) => send(res, { choices: [{ delta: { content: text } }] })

function lastUserText(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') return typeof msgs[i].content === 'string' ? msgs[i].content : JSON.stringify(msgs[i].content)
  }
  return ''
}

function plan(text) {
  const code = text.match(/【学生(\d{2})】/)
  if (code) return { chunks: ['## 草稿\n\n', '【学', `生${code[1]}】这学期进步很大。\n`, '\n- 第一条建议\n'], gap: 30 }
  if (text.includes('慢慢')) return { chunks: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段。`), gap: 150 }
  return { chunks: ['好的,这是草稿。\n\n', '- 第一条\n'], gap: 30 }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/last') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(last))
  }
  if (req.method === 'POST' && req.url === '/reset') {
    last = null
    res.writeHead(204)
    return res.end()
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let raw = ''
    for await (const c of req) raw += c
    try {
      last = JSON.parse(raw || '{}')
    } catch {
      res.writeHead(400)
      return res.end()
    }
    if (lastUserText(last).includes('出错')) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'bad key' } }))
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const { chunks, gap } = plan(lastUserText(last))
    let closed = false
    res.on('close', () => { closed = true })
    for (const c of chunks) {
      if (closed) return
      delta(res, c)
      await sleep(gap)
    }
    send(res, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } })
    res.write('data: [DONE]\n\n')
    return res.end()
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => console.log(`fake LLM on http://127.0.0.1:${PORT}`))
