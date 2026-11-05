import { expect, it } from 'vitest'
import { compareRoster } from './rosterOrder'

type Row = { student_no: string | null | undefined; name: string }
const order = (list: Row[]) =>
  [...list].sort(compareRoster).map((s) => `${s.student_no ?? ''}${s.name}`)

it('orders student numbers numerically', () => {
  expect(
    order([
      { student_no: '10', name: '甲' },
      { student_no: '2', name: '乙' },
    ]),
  ).toEqual(['2乙', '10甲'])
})

it('puts empty student numbers last (null, undefined and empty string alike)', () => {
  const list: Row[] = [
    { student_no: null, name: '甲' },
    { student_no: '', name: '乙' },
    { student_no: undefined, name: '丙' },
    { student_no: '3', name: '丁' },
  ]
  expect(order(list)[0]).toBe('3丁')
  expect(compareRoster(list[0], list[3])).toBeGreaterThan(0)
  expect(compareRoster(list[3], list[1])).toBeLessThan(0)
})

it('falls back to name for equal student numbers', () => {
  // zh-CN 拼音序:李(li)在王(wang)前
  const same = [
    { student_no: '10', name: '王' },
    { student_no: '10', name: '李' },
  ]
  expect(order(same)).toEqual(['10李', '10王'])
})

it('orders by name when all student numbers are empty', () => {
  const list: Row[] = [
    { student_no: null, name: 'b' },
    { student_no: '', name: 'a' },
  ]
  expect(order(list)).toEqual(['a', 'b'])
})
