import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/client', () => ({
  API_BASE: '/api/v1',
  tryRefreshAccessToken: vi.fn(),
}))

import { tryRefreshAccessToken } from '@/shared/api/client'
import type { RefreshResult } from '@/shared/api/client'
import { createRealtimeClient, realtimeUrl, type RealtimeEvent } from './client'

class FakeWS {
  static instances: FakeWS[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.()
  }
  msg(o: unknown) {
    this.onmessage?.({ data: JSON.stringify(o) })
  }
  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

const mkClient = (token: string | null = 'tok') => {
  const events: RealtimeEvent[] = []
  const c = createRealtimeClient({
    url: 'ws://h/api/v1/ws',
    getToken: () => token,
    onEvent: (e) => events.push(e),
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
  })
  return { c, events }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  FakeWS.instances = []
  vi.mocked(tryRefreshAccessToken).mockReset()
})
afterEach(() => vi.useRealTimers())

it('realtimeUrl 由 location 推出,令牌不进 URL', () => {
  expect(realtimeUrl()).toBe(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`,
  )
})

it('realtimeUrl 跟随绝对地址的 API_BASE(跨域部署)', () => {
  expect(realtimeUrl('https://api.example.test/api/v1')).toBe('wss://api.example.test/api/v1/ws')
  expect(realtimeUrl('http://localhost:8253/api/v1/')).toBe('ws://localhost:8253/api/v1/ws')
})

it('realtimeUrl 相对路径仍用 location', () => {
  expect(realtimeUrl('/api/v1')).toBe(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`,
  )
})

it('getToken 为 null 时不连', () => {
  const { c } = mkClient(null)
  c.start()
  expect(FakeWS.instances).toHaveLength(0)
})

it('连上先发 auth;start 幂等', () => {
  const { c } = mkClient()
  c.start()
  c.start()
  expect(FakeWS.instances).toHaveLength(1)
  last().open()
  expect(JSON.parse(last().sent[0])).toEqual({ type: 'auth', token: 'tok' })
  expect(last().url).not.toContain('tok')
})

it('ready 前的通知事件照常转发(服务端认证后即 register);ping 与未知忽略', () => {
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().msg({ type: 'ping' })
  last().msg({ type: 'notice.new', id: '0', title: 't', from_name: null, created_at: 'x' })
  last().msg({ type: 'notice.recalled', id: '0' })
  expect(events).toEqual([
    { type: 'notice.new', id: '0', title: 't', from_name: null, created_at: 'x' },
    { type: 'notice.recalled', id: '0' },
  ])
  events.length = 0
  last().msg({ type: 'ready' })
  last().msg({ type: 'ping' })
  last().msg({ type: 'whatever' })
  last().msg({ type: 'notice.new', id: '1', title: 't', from_name: 'a', created_at: 'x' })
  last().msg({ type: 'notice.recalled', id: '1' })
  expect(events).toEqual([
    { type: 'notice.new', id: '1', title: 't', from_name: 'a', created_at: 'x' },
    { type: 'notice.recalled', id: '1' },
  ])
})

it('断线按 1/2/4 秒退避重连;首次连接不发 reconnected,重连成功发一次并归零', () => {
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().msg({ type: 'ready' })
  expect(events).toEqual([])
  last().drop()
  expect(FakeWS.instances).toHaveLength(1)
  vi.advanceTimersByTime(999)
  expect(FakeWS.instances).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(FakeWS.instances).toHaveLength(2)
  last().drop() // 未 ready 就断:退避 2 秒
  vi.advanceTimersByTime(1999)
  expect(FakeWS.instances).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(FakeWS.instances).toHaveLength(3)
  last().drop() // 4 秒
  vi.advanceTimersByTime(3999)
  expect(FakeWS.instances).toHaveLength(3)
  vi.advanceTimersByTime(1)
  expect(FakeWS.instances).toHaveLength(4)
  last().open()
  last().msg({ type: 'ready' })
  expect(events).toEqual([{ type: 'reconnected' }])
  last().drop() // 归零:又是 1 秒
  vi.advanceTimersByTime(1000)
  expect(FakeWS.instances).toHaveLength(5)
})

it('退避封顶 30 秒', () => {
  const { c } = mkClient()
  c.start()
  for (const s of [1, 2, 4, 8, 16, 30, 30]) {
    const n = FakeWS.instances.length
    last().drop()
    vi.advanceTimersByTime(s * 1000 - 1)
    expect(FakeWS.instances).toHaveLength(n)
    vi.advanceTimersByTime(1)
    expect(FakeWS.instances).toHaveLength(n + 1)
  }
})

it('4401:刷新成功后立即再连', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('ok')
  const { c } = mkClient()
  c.start()
  last().open()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(1)
  expect(FakeWS.instances).toHaveLength(2)
})

it('4401:刷新失败则停止', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('rejected')
  const { c } = mkClient()
  c.start()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeWS.instances).toHaveLength(1)
})

it('4403:停止并发 session.revoked', () => {
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().msg({ type: 'ready' })
  last().drop(4403)
  vi.advanceTimersByTime(60_000)
  expect(FakeWS.instances).toHaveLength(1)
  expect(events).toEqual([{ type: 'session.revoked' }])
})

it('收到 session.revoked 转发,之后不再重连', () => {
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().msg({ type: 'ready' })
  last().msg({ type: 'session.revoked' })
  last().drop(1000)
  vi.advanceTimersByTime(60_000)
  expect(FakeWS.instances).toHaveLength(1)
  expect(events).toEqual([{ type: 'session.revoked' }])
})

it('stop 后关闭 socket、不再重连、不再回调', () => {
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().msg({ type: 'ready' })
  const ws = last()
  c.stop()
  expect(ws.closed).toBe(true)
  ws.msg({ type: 'notice.recalled', id: '1' })
  ws.drop()
  vi.advanceTimersByTime(60_000)
  expect(FakeWS.instances).toHaveLength(1)
  expect(events).toEqual([])
})

it('断线等待重连期间 stop 清掉定时器', () => {
  const { c } = mkClient()
  c.start()
  last().drop()
  c.stop()
  vi.advanceTimersByTime(60_000)
  expect(FakeWS.instances).toHaveLength(1)
})

it('4401 刷新成功后再连又 4401(期间无 ready):不再刷新、不再连', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('ok')
  const { c } = mkClient()
  c.start()
  last().open()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeWS.instances).toHaveLength(2)
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(1)
  expect(FakeWS.instances).toHaveLength(2)
})

it('ready 后清零 4401 标志:之后再遇 4401 可再刷新', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('ok')
  const { c } = mkClient()
  c.start()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  last().msg({ type: 'ready' })
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(2)
  expect(FakeWS.instances).toHaveLength(3)
})

it('4401 刷新进行中 stop 再 start:刷新完成后只有一个活动 socket', async () => {
  let resolve!: (v: RefreshResult) => void
  vi.mocked(tryRefreshAccessToken).mockReturnValue(
    new Promise<RefreshResult>((r) => {
      resolve = r
    }),
  )
  const { c } = mkClient()
  c.start()
  last().drop(4401)
  c.stop()
  c.start()
  expect(FakeWS.instances).toHaveLength(2)
  resolve('ok')
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeWS.instances).toHaveLength(2)
})

it('keeps reconnecting after network error during refresh', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValueOnce('network').mockResolvedValueOnce('ok')
  const { c, events } = mkClient()
  c.start()
  last().open()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(1)
  expect(FakeWS.instances).toHaveLength(1) // 网络错误:不立即连,按退避排下一次
  await vi.advanceTimersByTimeAsync(999)
  expect(FakeWS.instances).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(FakeWS.instances).toHaveLength(2)
  last().open()
  last().drop(4401) // 再次 4401:不受 refreshedSinceReady 限制,可再试刷新
  await vi.advanceTimersByTimeAsync(0)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(2)
  expect(FakeWS.instances).toHaveLength(3) // ok:立即重连
  last().open()
  last().msg({ type: 'ready' })
  expect(events).toEqual([{ type: 'reconnected' }])
})

it('network error during refresh backs off further on repeated failures', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('network')
  const { c } = mkClient()
  c.start()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(1000)
  expect(FakeWS.instances).toHaveLength(2)
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(1999)
  expect(FakeWS.instances).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(FakeWS.instances).toHaveLength(3)
})

it('stops after refresh rejected', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('rejected')
  const { c } = mkClient()
  c.start()
  last().open()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(tryRefreshAccessToken).toHaveBeenCalledTimes(1)
  expect(FakeWS.instances).toHaveLength(1)
})

it('stop during the retry wait after a network refresh error cancels the reconnect', async () => {
  vi.mocked(tryRefreshAccessToken).mockResolvedValue('network')
  const { c } = mkClient()
  c.start()
  last().drop(4401)
  await vi.advanceTimersByTimeAsync(0)
  c.stop()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeWS.instances).toHaveLength(1)
})
