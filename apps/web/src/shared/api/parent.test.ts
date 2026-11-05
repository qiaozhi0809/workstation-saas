import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import { parentApi } from './parent'

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
      contexts: ['parent'],
      admin_perms: [],
      must_change_password: false,
    },
  })
})

const contacts = [{ name: '王妈妈', relation: '母亲', phone: '13800000001', job: '会计' }]

const cases: [string, () => Promise<unknown>, string, string, unknown?][] = [
  ['children', () => parentApi.children(), 'GET', '/parent/children'],
  ['today no date', () => parentApi.today('s1'), 'GET', '/parent/children/s1/today'],
  [
    'today with date',
    () => parentApi.today('s1', '2026-11-03'),
    'GET',
    '/parent/children/s1/today?date=2026-11-03',
  ],
  ['profile', () => parentApi.profile('s1'), 'GET', '/parent/children/s1/profile'],
  [
    'saveContacts',
    () => parentApi.saveContacts('s1', contacts),
    'PUT',
    '/parent/children/s1/contacts',
    { contacts },
  ],
  ['growth', () => parentApi.growth('s1'), 'GET', '/parent/children/s1/growth-records'],
  ['comments', () => parentApi.comments('s1'), 'GET', '/parent/children/s1/comments'],
  ['reviews first page', () => parentApi.reviews('s1'), 'GET', '/parent/children/s1/reviews'],
  [
    'reviews cursor',
    () => parentApi.reviews('s1', 'a b'),
    'GET',
    '/parent/children/s1/reviews?cursor=a+b',
  ],
  ['exams', () => parentApi.exams('s1'), 'GET', '/parent/children/s1/exams'],
  ['exam', () => parentApi.exam('s1', 'e1'), 'GET', '/parent/children/s1/exams/e1'],
  ['id is encoded', () => parentApi.profile('a/b'), 'GET', '/parent/children/a%2Fb/profile'],
]

it.each(cases)('%s', async (_n, call, method, url, body) => {
  await call()
  const [u, init] = fetchMock.mock.calls[0]
  expect(init.method).toBe(method)
  expect(u).toBe(`/api/v1${url}`)
  expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(body)
})
