import { useAuthStore } from '@/shared/stores/auth'

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout']

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

let refreshing: Promise<boolean> | null = null

async function doRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { access_token?: string }
    if (!data.access_token) return false
    useAuthStore.getState().updateAccess(data.access_token)
    return true
  } catch {
    return false
  }
}

function refreshOnce(refreshToken: string): Promise<boolean> {
  refreshing ??= doRefresh(refreshToken).finally(() => {
    refreshing = null
  })
  return refreshing
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {}
  const { accessToken } = useAuthStore.getState()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function toApiError(res: Response): Promise<ApiError> {
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

function sessionExpired(): ApiError {
  useAuthStore.getState().logout()
  return new ApiError(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body)
  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) throw sessionExpired()
    if (!(await refreshOnce(refreshToken))) throw sessionExpired()
    res = await send(method, path, body)
    if (res.status === 401) throw sessionExpired()
  }
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
