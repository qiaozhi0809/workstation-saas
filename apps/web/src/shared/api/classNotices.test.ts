import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { classNoticesApi } from './classNotices'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r',
    user: { id: 'u', display_name: 'x', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
})
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return { method: init.method as string, url: url as string, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

it('list: GET /classes/{cid}/notices?page=', async () => {
  await classNoticesApi.list('c/1', 2)
  expect(lastCall()).toMatchObject({ method: 'GET', url: '/api/v1/classes/c%2F1/notices?page=2' })
})
it('send: POST /classes/{cid}/notices 带请求体', async () => {
  const body = { title: '家长会', content: '周五', ack: { kind: 'confirm' as const }, ack_deadline: null }
  await classNoticesApi.send('c1', body)
  expect(lastCall()).toEqual({ method: 'POST', url: '/api/v1/classes/c1/notices', body })
})
it('recall: POST /classes/{cid}/notices/{id}/recall', async () => {
  await classNoticesApi.recall('c1', 'n 1')
  expect(lastCall()).toMatchObject({ method: 'POST', url: '/api/v1/classes/c1/notices/n%201/recall' })
})
