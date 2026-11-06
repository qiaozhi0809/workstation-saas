// L150:实时连接因 4401 去刷新令牌时,另一标签重新登录把新令牌写进了 store——
// 不能把这当成"刷新被拒"而下线(authSync 还会把登出波及新会话)。这里用真实的 tryRefreshAccessToken。
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { createRealtimeClient, type RealtimeEvent } from './client'

class FakeWS {
  static instances: FakeWS[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {}
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1]
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  FakeWS.instances = []
  useAuthStore.setState({
    accessToken: 'old',
    refreshToken: 'ref',
    user: {
      id: 'u',
      display_name: 't',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('4401 刷新期间另一标签换了令牌:用新令牌重连,不发 session.expired、不登出', async () => {
  let resolveFirst!: (r: Response) => void
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        }),
    )
    .mockResolvedValueOnce(json({ access_token: 'fresh', expires_at: 'x' }))
  vi.stubGlobal('fetch', fetchMock)
  const events: RealtimeEvent[] = []
  const c = createRealtimeClient({
    url: 'ws://h/api/v1/ws',
    getToken: () => useAuthStore.getState().accessToken,
    onEvent: (e) => events.push(e),
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
  })
  c.start()
  last().onopen?.()
  last().onclose?.({ code: 4401 })
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  // 另一标签登录成功,authSync 把新会话写进本标签
  useAuthStore.setState({ accessToken: 'acc2', refreshToken: 'ref2' })
  resolveFirst(json({ access_token: 'stale', expires_at: 'x' }))
  await vi.waitFor(() => expect(FakeWS.instances).toHaveLength(2))
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refresh_token: 'ref2' })
  last().onopen?.()
  expect(JSON.parse(last().sent[0])).toEqual({ type: 'auth', token: 'fresh' })
  expect(events).toEqual([])
  expect(useAuthStore.getState().user).not.toBeNull()
  expect(useAuthStore.getState().refreshToken).toBe('ref2')
  c.stop()
})
