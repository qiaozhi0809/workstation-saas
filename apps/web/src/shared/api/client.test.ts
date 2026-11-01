import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { api, ApiError } from './client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'old', refreshToken: 'ref', user: { id: 'u', display_name: 't' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('refreshes once on 401 and retries', async () => {   // Review Focus #1
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ access_token: 'new', expires_at: '2026-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(json({ id: 'u', display_name: 't' }))
  vi.stubGlobal('fetch', fetchMock)
  const me = await api<{ display_name: string }>('GET', '/auth/me')
  expect(me.display_name).toBe('t')
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh')
  expect(useAuthStore.getState().accessToken).toBe('new')
})

it('clears session when refresh fails', async () => {   // Review Focus #1
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ error: { code: 'INVALID_REFRESH', message: 'x' } }, 401)))
  await expect(api('GET', '/auth/me')).rejects.toBeInstanceOf(ApiError)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('maps error envelope to ApiError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
    json({ error: { code: 'FORBIDDEN', message: 'no' } }, 403)))
  await expect(api('GET', '/students/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
})

it('throws UNAUTHORIZED after failed refresh', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ error: { code: 'INVALID_REFRESH', message: 'x' } }, 401)))
  await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(useAuthStore.getState().refreshToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
})

it('401 on a protected path without refresh token logs out and throws UNAUTHORIZED', async () => {
  useAuthStore.setState({ refreshToken: null })
  const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('401 on /auth/login does not refresh or log out', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'INVALID_CREDENTIALS', message: 'bad' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('POST', '/auth/login', { login_name: 'a', password: 'b' }))
    .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().refreshToken).toBe('ref')
})

it('concurrent 401s share a single refresh call', async () => {
  let refreshCalls = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls++
      return json({ access_token: 'new', expires_at: '2026-01-01T00:00:00Z' })
    }
    const auth = (init?.headers as Record<string, string>).Authorization
    return auth === 'Bearer new' ? json({ ok: 1 }) : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
  })
  vi.stubGlobal('fetch', fetchMock)
  const results = await Promise.all([api('GET', '/a'), api('GET', '/b'), api('GET', '/c')])
  expect(results).toEqual([{ ok: 1 }, { ok: 1 }, { ok: 1 }])
  expect(refreshCalls).toBe(1)
})

it('sends Content-Type only with a body and Authorization when token exists', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  await api('GET', '/x')
  await api('POST', '/y', { a: 1 })
  const get = fetchMock.mock.calls[0][1].headers
  const post = fetchMock.mock.calls[1][1].headers
  expect(get.Authorization).toBe('Bearer old')
  expect(get['Content-Type']).toBeUndefined()
  expect(post['Content-Type']).toBe('application/json')
  expect(fetchMock.mock.calls[1][1].body).toBe('{"a":1}')
})

it('returns undefined on 204 and HTTP_ERROR for non-envelope bodies', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })))
  await expect(api('DELETE', '/x')).resolves.toBeUndefined()
  await expect(api('GET', '/y')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR', message: 'Bad Gateway' })
})
