import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { LayoutDraft, LayoutSave } from '@/shared/types/seating'
import { seatingApi } from './seating'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r', user: { id: 'u', display_name: 'x', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
})

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return { method: init.method, url, body: init.body === undefined ? undefined : JSON.parse(init.body) }
}

const draft: LayoutDraft = { desk_size: 2, seat_layout: 'manual', rows: 5, cols: 8, podium_left: 1, podium_right: 0, how: 'keep' }

it('previews a layout draft', async () => {
  await seatingApi.preview('c1', draft)
  const c = lastCall()
  expect(c.method).toBe('POST')
  expect(c.url).toContain('/api/v1/classes/c1/layout/preview')
  expect(c.body).toEqual(draft)
})

it('saves a layout', async () => {
  const body: LayoutSave = { ...draft, base_version: 3, room: '201' }
  await seatingApi.saveLayout('c1', body)
  const c = lastCall()
  expect(c.method).toBe('PUT')
  expect(c.url).toMatch(/\/api\/v1\/classes\/c1\/layout$/)
  expect(c.body).toEqual(body)
})
