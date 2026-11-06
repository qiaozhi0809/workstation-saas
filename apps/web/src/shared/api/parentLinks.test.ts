import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { commentsApi } from './comments'
import { parentLinksApi } from './parentLinks'

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

const input = { phone: '13800000071', name: '李妈妈', relation: '母亲' as const }

const cases: [string, () => Promise<unknown>, string, string, unknown?][] = [
  ['list', () => parentLinksApi.list('s1'), 'GET', '/students/s1/parents'],
  ['create', () => parentLinksApi.create('s1', input), 'POST', '/students/s1/parents', input],
  ['setPrimary', () => parentLinksApi.setPrimary('l1'), 'POST', '/parent-links/l1/primary'],
  ['unlink', () => parentLinksApi.unlink('l1'), 'DELETE', '/parent-links/l1'],
  [
    'resetPassword',
    () => parentLinksApi.resetPassword('l1'),
    'POST',
    '/parent-links/l1/reset-password',
  ],
  [
    'setParentVisible',
    () => commentsApi.setParentVisible('m1', true),
    'PUT',
    '/comments/m1/parent-visible',
    { visible: true },
  ],
  [
    'setParentVisible off',
    () => commentsApi.setParentVisible('m1', false),
    'PUT',
    '/comments/m1/parent-visible',
    { visible: false },
  ],
]

it.each(cases)('%s', async (_n, call, method, url, body) => {
  await call()
  const [u, init] = fetchMock.mock.calls[0]
  expect(init.method).toBe(method)
  expect(u).toBe(`/api/v1${url}`)
  expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body)
})

it('unlink resolves on 204', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
  await expect(parentLinksApi.unlink('l1')).resolves.toBeUndefined()
})
