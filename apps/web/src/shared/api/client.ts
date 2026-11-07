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

/** 刷新结果:network = 请求没到服务端(可稍后重试);rejected = 服务端不认(401/403 等明确拒绝、本标签已登出);5xx 与网络异常同算 network */
export type RefreshResult = 'ok' | 'rejected' | 'network'

let refreshing: Promise<RefreshResult> | null = null

async function doRefresh(refreshToken: string, retried = false): Promise<RefreshResult> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (res.status >= 500) return 'network' // 服务端暂不可用(重启、网关 502/503/504):不是令牌的问题
    const current = useAuthStore.getState().refreshToken
    if (current !== refreshToken) {
      // 请求期间 store 里的刷新令牌变了:登出 → 不复活会话;另一标签重新登录(authSync 写进来的新会话)→
      // 旧令牌换来的 access 不能用,改用新令牌再试一次,而不是当成被拒把两个标签都登出(L150)
      if (!current || retried) return 'rejected'
      return doRefresh(current, true)
    }
    if (!res.ok) return 'rejected'
    const data = (await res.json()) as { access_token?: string }
    if (!data.access_token) return 'rejected'
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

/** 原样发送的请求体(不做 JSON 序列化),Content-Type 由调用方在 headers 里给。只收可重发的类型(Blob/File/FormData/string),不收流。 */
export type RawBody = Blob | File | FormData | string
export interface RawOpts {
  raw?: RawBody
  headers?: Record<string, string>
}

function send(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  rawOpts?: RawOpts,
): Promise<Response> {
  const headers: Record<string, string> = {}
  const { accessToken } = useAuthStore.getState()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const raw = rawOpts?.raw
  if (raw === undefined && body !== undefined) headers['Content-Type'] = 'application/json'
  Object.assign(headers, rawOpts?.headers)
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
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

/** 带 Bearer 的请求；401 时刷新一次令牌再重发，仍 401 则会话失效。返回原始 Response（不判 2xx）。
 * 403 PASSWORD_CHANGE_REQUIRED 在这里统一处理(标记 user 让 ProtectedRoute 跳 /change-password),
 * 直接用本函数的调用方(下载等)也能触发。 */
export async function authedFetch(
  method: string,
  path: string,
  opts?: { body?: unknown; signal?: AbortSignal } & RawOpts,
): Promise<Response> {
  const body = opts?.body
  const signal = opts?.signal
  let res = await send(method, path, body, signal, opts)
  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    const code = await errorCodeOf(res)
    if (code && BUSINESS_401_CODES.includes(code)) return res
    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) throw sessionExpired()
    const refreshed = await refreshOnce(refreshToken)
    if (refreshed === 'network') return res // 弱网 / 服务端暂不可用:保留登录态,这次请求按原 401 失败,下次请求再试刷新
    if (refreshed !== 'ok') throw sessionExpired()
    res = await send(method, path, body, signal, opts)
    if (res.status === 401) throw sessionExpired()
  }
  // 先比对不用读体就能知道的条件(状态码、认证接口、本地会话是否存在 / 是否已标记),都过了才 clone 读一次错误码(L303)
  if (
    res.status === 403 &&
    mayNeedPasswordChange(path) &&
    (await errorCodeOf(res)) === 'PASSWORD_CHANGE_REQUIRED'
  )
    await markPasswordChangeRequired()
  return res
}

/** 这个 403 有没有可能是 PASSWORD_CHANGE_REQUIRED:认证接口自己不会返回它;没有会话或已标记改密时也不用再问 */
function mayNeedPasswordChange(path: string): boolean {
  if (NO_REFRESH_PATHS.includes(path)) return false
  const { refreshToken, user } = useAuthStore.getState()
  return !!refreshToken && !!user && !user.must_change_password
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  rawOpts?: RawOpts,
): Promise<T> {
  const res = await authedFetch(method, path, { body, ...rawOpts })
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

let marking: Promise<void> | null = null

/** 并发多个 403 只发一次 /auth/me(单飞):后到的等同一个请求 */
function markPasswordChangeRequired(): Promise<void> {
  marking ??= doMarkPasswordChangeRequired().finally(() => {
    marking = null
  })
  return marking
}

/** 会话中密码到期:服务端对业务接口返回 403 PASSWORD_CHANGE_REQUIRED。刷新 store 里的 user,让 ProtectedRoute 跳 /change-password。
 * 直接用 send 而非 authApi.me(auth.ts 依赖本文件,避免循环引用);已标记时不再请求,避免重复/循环。 */
async function doMarkPasswordChangeRequired(): Promise<void> {
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
              : { ...me, must_change_password: true, password_change_reason: 'required' },
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
      .setUser({ ...latest, must_change_password: true, password_change_reason: 'required' })
}
