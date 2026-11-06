import { describe, expect, it } from 'vitest'
import { classSortKey, compareClassName } from './sort'

const sorted = (names: string[]) => [...names].sort(compareClassName)

describe('compareClassName', () => {
  it.each([
    ['三年二班', '三年三班'],
    ['三年三班', '三年十班'],
    ['三年九班', '三年十班'],
    ['三年十班', '三年十一班'],
    ['三年十一班', '三年二十班'],
    ['一年级', '十年级'],
    ['二年级', '十年级'],
    ['3班', '10班'],
    ['三年2班', '三年10班'],
    ['初一', '初二'],
    ['高一(1)班', '高一(2)班'],
    ['高一(9)班', '高一(10)班'],
    ['一年一班', '二年一班'],
    ['1班', '2班'],
  ])('%s < %s', (a, b) => {
    expect(compareClassName(a, b)).toBeLessThan(0)
    expect(compareClassName(b, a)).toBeGreaterThan(0)
  })

  it('sorts a mixed list numerically instead of by code point', () => {
    expect(sorted(['三年十班', '三年二班', '三年一班', '三年三班'])).toEqual([
      '三年一班',
      '三年二班',
      '三年三班',
      '三年十班',
    ])
    expect(sorted(['10班', '2班', '1班'])).toEqual(['1班', '2班', '10班'])
  })

  it('treats arabic and chinese numerals as the same value', () => {
    expect(sorted(['十班', '3班', '二班', '1班'])).toEqual(['1班', '二班', '3班', '十班'])
    expect(classSortKey('3班')).toEqual(classSortKey('三班'))
    expect(compareClassName('3班', '三班')).toBe(0)
  })

  it('reads 零 positionally, 十 by tens, and full-width digits as digits', () => {
    expect(classSortKey('一零一班')).toEqual([101, '班'])
    expect(classSortKey('二零二六级')).toEqual([2026, '级'])
    expect(classSortKey('二十一班')).toEqual([21, '班'])
    expect(classSortKey('十班')).toEqual([10, '班'])
    expect(classSortKey('１０班')).toEqual([10, '班'])
    expect(classSortKey('高一(10)班')).toEqual(['高', 1, '(', 10, ')班'])
  })

  it('falls back to plain text order when there is no number', () => {
    expect(compareClassName('实验班', '实验班')).toBe(0)
    expect(sorted(['乙班', '甲班'])).toEqual(['乙班', '甲班'].sort())
    expect(classSortKey('实验班')).toEqual(['实验班'])
  })

  it('puts a number before text at the same position and compares text segments as written', () => {
    // 三年级 以数字开头排最前;高一 与 实验班 都以文字开头,按码点 实 < 高
    expect(sorted(['高一', '三年级', '实验班'])).toEqual(['三年级', '实验班', '高一'])
    expect(sorted(['三年二班', '三年一班A', '三年一班'])).toEqual([
      '三年一班',
      '三年一班A',
      '三年二班',
    ])
  })
})
