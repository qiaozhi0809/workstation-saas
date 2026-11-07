import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { api, ApiError, authedFetch, refreshAccessToken, tryRefreshAccessToken } from './client'

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

it('tryRefreshAccessToken: 刷新期间另一标签重新登录换了令牌 → 用新令牌再试一次,不算 rejected', async () => {
  // L150:authSync 把另一标签的新会话写进了本标签的 store;旧令牌换来的 access 不能用,但也不该登出
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(async () => {
      useAuthStore.setState({ accessToken: 'acc2', refreshToken: 'ref2' })
      return json({ access_token: 'n4', expires_at: 'x' })
    })
    .mockResolvedValueOnce(json({ access_token: 'n5', expires_at: 'x' }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await tryRefreshAccessToken()).toBe('ok')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'ref' })
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refresh_token: 'ref2' })
  expect(useAuthStore.getState().accessToken).toBe('n5')
  expect(useAuthStore.getState().refreshToken).toBe('ref2')
})

it('tryRefreshAccessToken: 换了新令牌再试还是被换 / 被拒 → rejected,只重试一次', async () => {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(async () => {
      useAuthStore.setState({ refreshToken: 'ref2' })
      return json({ error: { code: 'INVALID_REFRESH', message: 'x' } }, 401)
    })
    .mockImplementationOnce(async () => {
      useAuthStore.setState({ refreshToken: 'ref3' })
      return json({ access_token: 'n6', expires_at: 'x' })
    })
  vi.stubGlobal('fetch', fetchMock)
  expect(await tryRefreshAccessToken()).toBe('rejected')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(useAuthStore.getState().accessToken).toBe('old')
})

it('tryRefreshAccessToken: 刷新期间登出(令牌变 null)→ rejected,不复活会话', async () => {
  const fetchMock = vi.fn().mockImplementationOnce(async () => {
    useAuthStore.getState().logout()
    return json({ access_token: 'n7', expires_at: 'x' })
  })
  vi.stubGlobal('fetch', fetchMock)
  expect(await tryRefreshAccessToken()).toBe('rejected')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('api(): 刷新期间另一标签换了令牌 → 请求用新 access 重发成功,不登出', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/auth/refresh')) {
      const { refresh_token } = JSON.parse(String(init?.body)) as { refresh_token: string }
      if (refresh_token === 'ref') {
        useAuthStore.setState({ accessToken: 'acc2', refreshToken: 'ref2' })
        return json({ access_token: 'stale', expires_at: 'x' })
      }
      return json({ access_token: 'fresh', expires_at: 'x' })
    }
    const auth = (init?.headers as Record<string, string>).Authorization
    return auth === 'Bearer fresh'
      ? json({ ok: 1 })
      : json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401)
  })
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/a')).resolves.toEqual({ ok: 1 })
  expect(useAuthStore.getState().user).not.toBeNull()
  expect(useAuthStore.getState().refreshToken).toBe('ref2')
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

const err = (code: string, status: number) => json({ error: { code, message: 'x' } }, status)

it.each([
  ['/auth/totp/disable', 'INVALID_CREDENTIALS'],
  ['/auth/totp/disable', 'WRONG_PASSWORD'],
  ['/auth/totp/enable', 'TOTP_INVALID'],
  ['/auth/totp/enable', 'MFA_EXPIRED'],
])('401 %s %s does not refresh or log out', async (path, code) => {
  const fetchMock = vi.fn().mockResolvedValue(err(code, 401))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('POST', path, {})).rejects.toMatchObject({ status: 401, code })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().accessToken).toBe('old')
  expect(useAuthStore.getState().user).not.toBeNull()
})

it('401 with a non-JSON body still refreshes once', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('oops', { status: 401 }))
    .mockResolvedValueOnce(json({ access_token: 'new' }))
    .mockResolvedValueOnce(json({ ok: 1 }))
  vi.stubGlobal('fetch', fetchMock)
  await api('GET', '/x')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('403 PASSWORD_CHANGE_REQUIRED marks user and routes to /change-password', async () => {
  const fresh = {
    id: 'u',
    display_name: 't',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: true,
    password_change_reason: 'expired',
  }
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
    .mockResolvedValueOnce(json(fresh))
    .mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(useAuthStore.getState().user).toMatchObject({
    must_change_password: true,
    password_change_reason: 'expired',
  })
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/me')
  // 已标记后再次 403 不再请求 /auth/me
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('403 PASSWORD_CHANGE_REQUIRED falls back to a local flag with reason "required" when /auth/me fails', async () => {
  // 取不到服务端的原因就不冒充"已过期":改密页对 'required' 显示中性文案
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
    .mockRejectedValueOnce(new TypeError('net'))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(useAuthStore.getState().user).toMatchObject({
    must_change_password: true,
    password_change_reason: 'required',
  })
})

it('403 PASSWORD_CHANGE_REQUIRED when /auth/me still says no change needed: flag locally as "required"', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
    .mockResolvedValueOnce(
      json({
        id: 'u',
        display_name: 't2',
        contexts: ['teacher'],
        admin_perms: [],
        must_change_password: false,
        password_change_reason: null,
      }),
    )
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(useAuthStore.getState().user).toMatchObject({
    display_name: 't2',
    must_change_password: true,
    password_change_reason: 'required',
  })
})

it('403 PASSWORD_CHANGE_REQUIRED through authedFetch (downloads) marks the user too', async () => {
  const fresh = {
    id: 'u',
    display_name: 't',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: true,
    password_change_reason: 'first_login',
  }
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
    .mockResolvedValueOnce(json(fresh))
  vi.stubGlobal('fetch', fetchMock)
  const res = await authedFetch('GET', '/reports/x.csv')
  expect(res.status).toBe(403)
  expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/me')
  expect(useAuthStore.getState().user).toMatchObject({
    must_change_password: true,
    password_change_reason: 'first_login',
  })
  // 调用方仍能读到原始响应体
  await expect(res.json()).resolves.toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } })
})

it('403 handling reads body once after compare', async () => {
  // L303:403 先比对状态码与本地会话——已标记改密 / 没有会话 / 认证接口——都用不着时不读响应体;
  // 要比对错误码时只 clone 读一次
  const clone = vi.spyOn(Response.prototype, 'clone')
  const base = useAuthStore.getState().user!
  // 已标记改密:不读体,也不再请求 /auth/me
  useAuthStore.setState({
    user: { ...base, must_change_password: true, password_change_reason: 'expired' },
  })
  let fetchMock = vi.fn().mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(clone).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  // 未标记:读一次体比对;不是 PASSWORD_CHANGE_REQUIRED 就到此为止
  useAuthStore.setState({ user: { ...base, must_change_password: false } })
  fetchMock = vi.fn().mockResolvedValueOnce(err('FORBIDDEN', 403))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  expect(clone).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().user?.must_change_password).toBe(false)
  // 认证接口自己的 403 不会是 PASSWORD_CHANGE_REQUIRED:不读体
  clone.mockClear()
  fetchMock = vi.fn().mockResolvedValueOnce(err('FORBIDDEN', 403))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('POST', '/auth/logout', { refresh_token: 'ref' })).rejects.toMatchObject({
    status: 403,
  })
  expect(clone).not.toHaveBeenCalled()
  // 没有会话(未登录 / 已登出)时的 403 也不读体、不去标记
  clone.mockClear()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  fetchMock = vi.fn().mockResolvedValueOnce(err('PASSWORD_CHANGE_REQUIRED', 403))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('GET', '/classes')).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  expect(clone).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().user).toBeNull()
  clone.mockRestore()
})

it('concurrent 403 PASSWORD_CHANGE_REQUIRED responses fetch /auth/me once', async () => {
  let meCalls = 0
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) {
      meCalls++
      await new Promise((r) => setTimeout(r, 5))
      return json({
        id: 'u',
        display_name: 't',
        contexts: ['teacher'],
        admin_perms: [],
        must_change_password: true,
        password_change_reason: 'expired',
      })
    }
    return err('PASSWORD_CHANGE_REQUIRED', 403)
  })
  vi.stubGlobal('fetch', fetchMock)
  const results = await Promise.allSettled([
    api('GET', '/a'),
    api('GET', '/b'),
    authedFetch('GET', '/c.csv'),
  ])
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'fulfilled'])
  expect(meCalls).toBe(1)
  expect(fetchMock).toHaveBeenCalledTimes(4)
  expect(useAuthStore.getState().user).toMatchObject({
    must_change_password: true,
    password_change_reason: 'expired',
  })
})

it('400 WRONG_PASSWORD on /auth/totp/disable surfaces the error without refresh or logout', async () => {
  const fetchMock = vi.fn().mockResolvedValue(err('WRONG_PASSWORD', 400))
  vi.stubGlobal('fetch', fetchMock)
  await expect(api('POST', '/auth/totp/disable', {})).rejects.toMatchObject({
    status: 400,
    code: 'WRONG_PASSWORD',
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().accessToken).toBe('old')
})

it('sends a raw body untouched with caller Content-Type and resends it after refresh', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }, 401))
    .mockResolvedValueOnce(json({ access_token: 'new' }))
    .mockResolvedValueOnce(json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  const blob = new Blob(['a,b'], { type: 'text/csv' })
  await api('POST', '/x', undefined, { raw: blob, headers: { 'Content-Type': 'text/csv' } })
  const first = fetchMock.mock.calls[0][1]
  expect(first.body).toBe(blob)
  expect(first.headers['Content-Type']).toBe('text/csv')
  expect(first.headers.Authorization).toBe('Bearer old')
  const resend = fetchMock.mock.calls[2][1]
  expect(resend.body).toBe(blob)
  expect(resend.headers['Content-Type']).toBe('text/csv')
  expect(resend.headers.Authorization).toBe('Bearer new')
})

it('still JSON-stringifies normal bodies', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(json({}))
  vi.stubGlobal('fetch', fetchMock)
  await api('POST', '/x', { a: 1 })
  expect(fetchMock.mock.calls[0][1].body).toBe('{"a":1}')
  expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json')
})
