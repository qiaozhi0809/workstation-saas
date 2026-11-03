import { expect, it } from 'vitest'
import { homeFor } from './home'

const u = (contexts: ('teacher' | 'admin')[], must = false) => ({ contexts, must_change_password: must })

it('routes by identity', () => {
  expect(homeFor(u(['teacher']), null)).toBe('/teacher')
  expect(homeFor(u(['admin']), null)).toBe('/admin')
  expect(homeFor(u(['teacher', 'admin']), null)).toBe('/teacher')
  expect(homeFor(u(['teacher', 'admin']), 'admin')).toBe('/admin')
  expect(homeFor(u(['teacher']), 'admin')).toBe('/teacher')
  expect(homeFor(u(['teacher'], true), null)).toBe('/change-password')
  expect(homeFor(u([]), null)).toBe('/login')
})
