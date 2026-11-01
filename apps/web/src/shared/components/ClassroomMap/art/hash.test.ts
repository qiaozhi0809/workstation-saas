import { hashString, pickBy, seededRandom } from './hash'

it('hashes deterministically to an unsigned 32-bit int', () => {
  expect(hashString('seed-01')).toBe(hashString('seed-01'))
  expect(hashString('seed-01')).not.toBe(hashString('seed-02'))
  expect(hashString('任意')).toBeGreaterThanOrEqual(0)
  expect(hashString('任意')).toBeLessThan(2 ** 32)
})

it('picks stably and seeds a repeatable random stream', () => {
  expect(pickBy(['a', 'b', 'c'], 'x')).toBe(pickBy(['a', 'b', 'c'], 'x'))
  const a = seededRandom('desk'), b = seededRandom('desk')
  const xs = [a(), a(), a()]
  expect([b(), b(), b()]).toEqual(xs)
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
})
