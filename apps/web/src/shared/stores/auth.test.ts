import { expect, it } from 'vitest'
import { useAuthStore } from './auth'

const migrate = () => useAuthStore.persist.getOptions().migrate!

it('wipes credentials from a pre-v1 persisted state', async () => {
  const old = { accessToken: 'a', refreshToken: 'r', user: { id: 'u', display_name: 't' }, lastContext: 'teacher' }
  const next = (await migrate()(old, 0)) as typeof old & { user: unknown }
  expect(next.accessToken).toBeNull()
  expect(next.refreshToken).toBeNull()
  expect(next.user).toBeNull()
  expect(next.lastContext).toBe('teacher')
})

it('keeps a v1 state as is', async () => {
  const cur = { accessToken: 'a', refreshToken: 'r', user: null, lastContext: null }
  expect(await migrate()(cur, 1)).toEqual(cur)
})
