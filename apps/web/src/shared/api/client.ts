import { useAuthStore } from '@/shared/stores/auth'

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1'
const BASE = API_BASE
const NO_REFRESH_PATHS = ['/auth/login', '/auth/login/totp', '/auth/refresh', '/auth/logout']

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 刷新结果:network = 请求没到服务端(可稍后重试);rejected = 服务端不认(401/403 等明确拒绝、令牌已被换掉);5xx 与网络异常同算 network */
export type RefreshResult = 'ok' | 'rejected' | 'network'

let refreshing: Promise<RefreshResult> | null = null

async function doRefresh(refreshToken: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (res.status >= 500) return 'network' // 服务端暂不可用(重启、网关 502/503/504):不是令牌的问题
    if (!res.ok) return 'rejected'
    const data = (await res.json()) as { access_token?: string }
    if (!data.access_token) return 'rejected'
    if (useAuthStore.getState().refreshToken !== refreshToken) return 'rejected'
    useAuthStore.getState().updateAccess(data.access_token)
    return 'ok'
  } catch {
    return 'network'
  }
}

function refreshOnce(refreshToken: string): Promise<RefreshResult> {
  refreshing ??= doRefresh(refreshToken).finally(() => {
    refreshing = null
  })
  return refreshing
}

/** 用 store 里的刷新令牌换新 access(复用 refreshOnce 的并发合并);无刷新令牌算 rejected */
export async function tryRefreshAccessToken(): Promise<RefreshResult> {
  const { refreshToken } = useAuthStore.getState()
  if (!refreshToken) return 'rejected'
  return refreshOnce(refreshToken)
}

export async function refreshAccessToken(): Promise<boolean> {
  return (await tryRefreshAccessToken()) === 'ok'
}

function send(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {}
  const { accessToken } = useAuthStore.getState()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
}

/** 把非 2xx 响应转成 ApiError（读不出错误外壳时给通用 HTTP_ERROR） */
export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json()
    const err = data?.error
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      return new ApiError(res.status, err.code, err.message, err.details)
    }
  } catch {
    // body is not JSON; fall through to the generic error
  }
  return new ApiError(res.status, 'HTTP_ERROR', res.statusText || `HTTP ${res.status}`)
}

/** 这些 401 是"业务性拒绝"(密码/验证码错、挑战过期):令牌本身有效,不刷新、不重发、不登出 */
const BUSINESS_401_CODES = ['INVALID_CREDENTIALS', 'WRONG_PASSWORD', 'TOTP_INVALID', 'MFA_EXPIRED']

async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const data = await res.clone().json()
    const code = data?.error?.code
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

function sessionExpired(): ApiError {
  useAuthStore.getState().logout()
  return new ApiError(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
}

/** 带 Bearer 的请求；401 时刷新一次令牌再重发，仍 401 则会话失效。返回原始 Response（不判 2xx）。 */
export async function authedFetch(
  method: string,
  path: string,
  opts?: { body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  const body = opts?.body
  const signal = opts?.signal
  let res = await send(method, path, body, signal)
  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    const code = await errorCodeOf(res)
    if (code && BUSINESS_401_CODES.includes(code)) return res
    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) throw sessionExpired()
    const refreshed = await refreshOnce(refreshToken)
    if (refreshed === 'network') return res // 弱网 / 服务端暂不可用:保留登录态,这次请求按原 401 失败,下次请求再试刷新
    if (refreshed !== 'ok') throw sessionExpired()
    res = await send(method, path, body, signal)
    if (res.status === 401) throw sessionExpired()
  }
  return res
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await authedFetch(method, path, { body })
  if (!res.ok) {
    const apiErr = await toApiError(res)
    if (res.status === 403 && apiErr.code === 'PASSWORD_CHANGE_REQUIRED')
      await markPasswordChangeRequired()
    throw apiErr
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** 会话中密码到期:服务端对业务接口返回 403 PASSWORD_CHANGE_REQUIRED。刷新 store 里的 user,让 ProtectedRoute 跳 /change-password。
 * 直接用 send 而非 authApi.me(auth.ts 依赖本文件,避免循环引用);已标记时不再请求,避免重复/循环。 */
async function markPasswordChangeRequired(): Promise<void> {
  const current = useAuthStore.getState().user
  if (!current || current.must_change_password) return
  try {
    const res = await send('GET', '/auth/me')
    if (res.ok) {
      const me = (await res.json()) as typeof current
      if (me && typeof me === 'object') {
        useAuthStore
          .getState()
          .setUser(
            me.must_change_password
              ? me
              : { ...me, must_change_password: true, password_change_reason: 'expired' },
          )
        return
      }
    }
  } catch {
    // fall through to the local flag
  }
  const latest = useAuthStore.getState().user
  if (latest)
    useAuthStore
      .getState()
      .setUser({ ...latest, must_change_password: true, password_change_reason: 'expired' })
}
