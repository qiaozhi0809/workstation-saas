import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { api, ApiError, refreshAccessToken, tryRefreshAccessToken } from './client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
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

it('refreshes once on 401 and retries', async () => {
  // Review Focus #1
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ access_token: 'new', expires_at: '2026-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(
      json({
        id: 'u',
        display_name: 't',
        contexts: ['teacher'],
        admin_perms: [],
        must_change_password: false,
        password_change_reason: null,
      }),
    )
  vi.stubGlobal('fetch', fetchMock)
  const me = await api<{ display_name: string }>('GET', '/auth/me')
  expect(me.display_name).toBe('t')
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh')
  expect(useAuthStore.getState().accessToken).toBe('new')
})

it('clears session when refresh fails', async () => {
  // Review Focus #1
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
      .mockResolvedValueOnce(json({ error: { code: 'INVALID_REFRESH', message: 'x' } }, 401)),
  )
  await expect(api('GET', '/auth/me')).rejects.toBeInstanceOf(ApiError)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('maps error envelope to ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json({ error: { code: 'FORBIDDEN', message: 'no' } }, 403)),
  )
  await expect(api('GET', '/students/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
})

it('throws UNAUTHORIZED after failed refresh', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
      .mockResolvedValueOnce(json({ error: { code: 'INVALID_REFRESH', message: 'x' } }, 401)),
  )
  await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(useAuthStore.getState().refreshToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()
})

it('401 on a protected path without refresh token logs out and throws UNAUTHORIZED', async () => {
  useAuthStore.setState({ refreshToken: null })
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('401 on /auth/login does not refresh or log out', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'INVALID_CREDENTIALS', message: 'bad' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    api('POST', '/auth/login', { login_name: 'a', password: 'b' }),
  ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().refreshToken).toBe('ref')
})

it('401 on /auth/login/totp does not refresh or log out', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOTP_INVALID', message: 'bad' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    api('POST', '/auth/login/totp', { mfa_token: 't', code: '000000' }),
  ).rejects.toMatchObject({ status: 401, code: 'TOTP_INVALID' })
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
    return auth === 'Bearer new'
      ? json({ ok: 1 })
      : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
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
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      ),
  )
  await expect(api('DELETE', '/x')).resolves.toBeUndefined()
  await expect(api('GET', '/y')).rejects.toMatchObject({
    status: 502,
    code: 'HTTP_ERROR',
    message: 'Bad Gateway',
  })
})

it('does not resurrect the session when logout happens during an in-flight refresh', async () => {
  let resolveRefresh!: (r: Response) => void
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve
        }),
    )
  vi.stubGlobal('fetch', fetchMock)
  const pending = api('GET', '/auth/me')
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  useAuthStore.getState().logout()
  resolveRefresh(json({ access_token: 'new', expires_at: '2026-01-01T00:00:00Z' }))
  await expect(pending).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('logs out and throws UNAUTHORIZED when the retry after a successful refresh is still 401', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ access_token: 'new', expires_at: '2026-01-01T00:00:00Z' }))
    .mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('refreshAccessToken: 无刷新令牌返回 false;成功更新 access', async () => {
  useAuthStore.setState({ refreshToken: null })
  expect(await refreshAccessToken()).toBe(false)
  useAuthStore.setState({ refreshToken: 'ref' })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json({ access_token: 'n2', expires_at: 'x' })),
  )
  expect(await refreshAccessToken()).toBe(true)
  expect(useAuthStore.getState().accessToken).toBe('n2')
})

it('refreshAccessToken: 刷新失败返回 false', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json({ error: { code: 'X', message: 'x' } }, 401)),
  )
  expect(await refreshAccessToken()).toBe(false)
})

it('tryRefreshAccessToken: ok / rejected / network', async () => {
  useAuthStore.setState({ refreshToken: null })
  expect(await tryRefreshAccessToken()).toBe('rejected') // 无刷新令牌
  useAuthStore.setState({ refreshToken: 'ref' })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json({ access_token: 'n3', expires_at: 'x' })),
  )
  expect(await tryRefreshAccessToken()).toBe('ok')
  expect(useAuthStore.getState().accessToken).toBe('n3')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(json({ error: { code: 'X', message: 'x' } }, 401)),
  )
  expect(await tryRefreshAccessToken()).toBe('rejected')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({})))
  expect(await tryRefreshAccessToken()).toBe('rejected') // 无 access_token
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')))
  expect(await tryRefreshAccessToken()).toBe('network')
})

it('tryRefreshAccessToken: 刷新令牌在请求期间已换掉 → rejected', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementationOnce(async () => {
      useAuthStore.setState({ refreshToken: 'other' })
      return json({ access_token: 'n4', expires_at: 'x' })
    }),
  )
  expect(await tryRefreshAccessToken()).toBe('rejected')
  expect(useAuthStore.getState().accessToken).toBe('old')
})

it('refreshAccessToken: 网络错误返回 false', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')))
  expect(await refreshAccessToken()).toBe(false)
})

it('tryRefreshAccessToken: 5xx 与网络异常同算 network,401/403 算 rejected', async () => {
  for (const status of [502, 503, 504]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, status)))
    expect(await tryRefreshAccessToken()).toBe('network')
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 403)))
  expect(await tryRefreshAccessToken()).toBe('rejected')
})

it('keeps the session when the refresh hits a network error or 503; the request fails with its original 401', async () => {
  for (const refreshOutcome of [
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => Promise.resolve(json({}, 503)),
  ]) {
    useAuthStore.setState({ accessToken: 'old', refreshToken: 'ref' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
        .mockImplementationOnce(refreshOutcome),
    )
    await expect(api('GET', '/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    })
    expect(useAuthStore.getState().refreshToken).toBe('ref')
    expect(useAuthStore.getState().user).not.toBeNull()
  }
})
