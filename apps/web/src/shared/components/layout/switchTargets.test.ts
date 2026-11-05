import { expect, it } from 'vitest'
import { switchTargets } from './switchTargets'

it('lists every other context the account has, in a fixed order', () => {
  expect(
    switchTargets(['parent', 'admin', 'teacher'], 'teacher').map((s) => [s.context, s.to]),
  ).toEqual([
    ['admin', '/admin'],
    ['parent', '/parent'],
  ])
  expect(switchTargets(['teacher', 'admin', 'parent'], 'parent').map((s) => s.label)).toEqual([
    '切换到教师端',
    '切换到管理端',
  ])
})

it('is empty for a single context or no user', () => {
  expect(switchTargets(['teacher'], 'teacher')).toEqual([])
  expect(switchTargets(undefined, 'admin')).toEqual([])
})
