import { API_BASE, tryRefreshAccessToken } from '@/shared/api/client'

export type RealtimeEvent =
  | { type: 'notice.new'; id: string; title: string; from_name: string | null; created_at: string }
  | { type: 'notice.recalled'; id: string }
  | { type: 'session.revoked' }
  | { type: 'session.expired' }
  | { type: 'reconnected' }

export interface RealtimeOptions {
  url: string
  getToken(): string | null
  onEvent(e: RealtimeEvent): void
  WebSocketImpl?: typeof WebSocket
}

const BACKOFF_S = [1, 2, 4, 8, 16, 30]

/**
 * WebSocket 地址:`base` 是 http(s) 绝对地址时(跨域部署,VITE_API_BASE)换成 ws(s) 同主机同路径;
 * 相对路径时由 location 推出。令牌不进 URL,连上后用首条 auth 消息发送
 */
export function realtimeUrl(base: string = API_BASE): string {
  const abs = /^http(s?):\/\/(.+)$/i.exec(base)
  if (abs) return `ws${abs[1].toLowerCase()}://${abs[2].replace(/\/+$/, '')}/ws`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base.replace(/\/+$/, '')}/ws`
}

export function createRealtimeClient(opts: RealtimeOptions): { start(): void; stop(): void } {
  const WS = opts.WebSocketImpl ?? WebSocket
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false // start 之后、stop 之前
  let terminal = false // 4403 / session.revoked:不再重连
  let everDropped = false
  let attempt = 0
  let ready = false
  let gen = 0 // start/stop 递增,作废进行中的刷新回调
  let refreshedSinceReady = false

  const emit = (e: RealtimeEvent) => {
    if (active) opts.onEvent(e)
  }

  const finish = () => {
    terminal = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleReconnect = () => {
    const delay = BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)]
    attempt += 1
    timer = setTimeout(() => {
      timer = null
      connect()
    }, delay * 1000)
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
      try {
        msg = JSON.parse(String(m.data))
      } catch {
        return
      }
      if (msg.type === 'ready') {
        ready = true
        attempt = 0
        refreshedSinceReady = false
        if (everDropped) emit({ type: 'reconnected' })
        return
      }
      // 服务端认证通过即 register,通知事件可能早于 ready 到达,照常转发
      if (msg.type === 'notice.new' || msg.type === 'notice.recalled') {
        emit(msg as unknown as RealtimeEvent)
      } else if (ready && msg.type === 'session.revoked') {
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
        // 令牌失效:刷新成功立即再连;被拒停止;网络错误按退避表再连(下次仍 4401 可再试刷新)
        if (refreshedSinceReady) {
          finish()
          return
        } // 刷新成功后仍被拒:停止,避免紧循环
        const myGen = gen
        void tryRefreshAccessToken().then((result) => {
          if (!active || terminal || gen !== myGen) return
          if (result === 'ok') {
            refreshedSinceReady = true
            connect()
          } else if (result === 'rejected') {
            // 服务端明确不认刷新令牌(改密 / 重置已撤销):与 4403 同样下线,不等下一次请求
            finish()
            emit({ type: 'session.expired' })
          } else {
            scheduleReconnect()
          }
        })
      } else {
        refreshedSinceReady = false // 非令牌原因的断线:之后再遇 4401 允许重新刷新
        scheduleReconnect()
      }
    }
    sock.onerror = () => {
      /* 随后会触发 close,在那里处理重连 */
    }
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
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      const sock = ws
      ws = null
      if (sock) sock.close()
    },
  }
}
