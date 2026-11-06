import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { ApiError } from './client'
import { noticesApi } from './notices'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: 'x',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return {
    method: init.method as string,
    url: url as string,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  }
}

it('ack: POST /notices/{id}/ack 带请求体,204 无响应体', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
  await noticesApi.ack('n/1', { choice: 1, note: '好的' })
  expect(lastCall()).toEqual({
    method: 'POST',
    url: '/api/v1/notices/n%2F1/ack',
    body: { choice: 1, note: '好的' },
  })
})

it('acks: GET /notices/{id}/acks', async () => {
  await noticesApi.acks('n1')
  expect(lastCall()).toMatchObject({ method: 'GET', url: '/api/v1/notices/n1/acks' })
})

it('exportAcks: GET 带 Bearer,令牌不进 URL,返回 Blob', async () => {
  fetchMock.mockImplementation(async () => new Response('a,b', { status: 200 }))
  const blob = await noticesApi.exportAcks('n1')
  expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
  expect(await blob.text()).toBe('a,b')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/v1/notices/n1/acks/export')
  expect(init.method).toBe('GET')
  expect(init.headers.Authorization).toBe('Bearer a')
  expect(url).not.toContain('token')
})

it('exportAcks: 非 2xx 抛 ApiError', async () => {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '没有这条通知' } }), {
        status: 404,
      }),
  )
  await expect(noticesApi.exportAcks('n1')).rejects.toBeInstanceOf(ApiError)
})
