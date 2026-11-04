import { refreshAccessToken } from '@/shared/api/client'

export type RealtimeEvent =
  | { type: 'notice.new'; id: string; title: string; from_name: string | null; created_at: string }
  | { type: 'notice.recalled'; id: string }
  | { type: 'session.revoked' }
  | { type: 'reconnected' }

export interface RealtimeOptions {
  url: string
  getToken(): string | null
  onEvent(e: RealtimeEvent): void
  WebSocketImpl?: typeof WebSocket
}

const BACKOFF_S = [1, 2, 4, 8, 16, 30]

/** 由 location 推出的 WebSocket 地址;令牌不进 URL,连上后用首条 auth 消息发送 */
export function realtimeUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`
}

export function createRealtimeClient(opts: RealtimeOptions): { start(): void; stop(): void } {
  const WS = opts.WebSocketImpl ?? WebSocket
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false       // start 之后、stop 之前
  let terminal = false     // 4403 / session.revoked:不再重连
  let everDropped = false
  let attempt = 0
  let ready = false
  let gen = 0              // start/stop 递增,作废进行中的刷新回调
  let refreshedSinceReady = false

  const emit = (e: RealtimeEvent) => { if (active) opts.onEvent(e) }

  const finish = () => {
    terminal = true
    if (timer) { clearTimeout(timer); timer = null }
  }

  const connect = () => {
    if (!active || terminal) return
    const token = opts.getToken()
    if (!token) return
    ready = false
    const sock = new WS(opts.url)
    ws = sock
    sock.onopen = () => {
      if (ws !== sock) return
      sock.send(JSON.stringify({ type: 'auth', token: opts.getToken() ?? token }))
    }
    sock.onmessage = (m: MessageEvent) => {
      if (ws !== sock || !active) return
      let msg: { type?: string } & Record<string, unknown>
      try { msg = JSON.parse(String(m.data)) } catch { return }
      if (msg.type === 'ready') {
        ready = true
        attempt = 0
        refreshedSinceReady = false
        if (everDropped) emit({ type: 'reconnected' })
        return
      }
      if (!ready) return
      if (msg.type === 'notice.new' || msg.type === 'notice.recalled') {
        emit(msg as unknown as RealtimeEvent)
      } else if (msg.type === 'session.revoked') {
        finish()
        emit({ type: 'session.revoked' })
        sock.close()
      }
    }
    sock.onclose = (e: CloseEvent) => {
      if (ws !== sock) return
      ws = null
      if (!active || terminal) return
      everDropped = true
      if (e.code === 4403) {
        finish()
        emit({ type: 'session.revoked' })
      } else if (e.code === 4401) {
        // 令牌失效:刷新成功后立即再连,失败则停止
        if (refreshedSinceReady) { finish(); return }   // 刷新过仍被拒:停止,避免紧循环
        refreshedSinceReady = true
        const myGen = gen
        void refreshAccessToken().then((ok) => {
          if (!active || terminal || gen !== myGen) return
          if (ok) connect()
          else finish()
        })
      } else {
        const delay = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)]
        attempt += 1
        timer = setTimeout(() => { timer = null; connect() }, delay * 1000)
      }
    }
    sock.onerror = () => { /* 随后会触发 close,在那里处理重连 */ }
  }

  return {
    start() {
      if (active) return
      active = true
      gen += 1
      terminal = false
      refreshedSinceReady = false
      connect()
    },
    stop() {
      active = false
      gen += 1
      if (timer) { clearTimeout(timer); timer = null }
      const sock = ws
      ws = null
      if (sock) sock.close()
    },
  }
}
