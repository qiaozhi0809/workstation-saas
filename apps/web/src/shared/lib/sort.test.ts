import { describe, expect, it } from 'vitest'
import { classSortKey, compareClassName } from './sort'

const sorted = (names: string[]) => [...names].sort(compareClassName)

describe('compareClassName', () => {
  // 与后端 server/tests/test_grading.py::test_class_sort_key 的参数化用例逐条相同
  it.each<[string[], string[]]>([
    // 中文数字按数值比,不按码位("三" U+4E09 < "二" U+4E8C 的码位序是错的)
    [
      ['三年十班', '三年三班', '三年二班'],
      ['三年二班', '三年三班', '三年十班'],
    ],
    [
      ['十年级', '一年级', '二年级'],
      ['一年级', '二年级', '十年级'],
    ],
    // 阿拉伯数字与中文数字同序
    [
      ['四班', '3班', '一班', '2班'],
      ['一班', '2班', '3班', '四班'],
    ],
    [
      ['高三1班', '高一2班', '高二10班'],
      ['高一2班', '高二10班', '高三1班'],
    ],
    [
      ['初三(10)班', '初三(2)班', '初三(1)班'],
      ['初三(1)班', '初三(2)班', '初三(10)班'],
    ],
    [
      ['二十一班', '三班', '十二班'],
      ['三班', '十二班', '二十一班'],
    ],
    // 没有数字的按原文(码位序)
    [
      ['实验班', '国际部'],
      ['国际部', '实验班'],
    ],
    [
      ['实验班', '三年二班', '三年一班'],
      ['三年一班', '三年二班', '实验班'],
    ],
  ])('sorts %j as the backend does', (names, expected) => {
    expect(sorted(names)).toEqual(expected)
    expect(sorted([...names].reverse())).toEqual(expected)
  })

  // 与后端 test_class_sort_key_is_total_and_stable 相同
  it('is a total order: same segments fall back to the raw name', () => {
    expect(classSortKey('3班').slice(0, -1)).toEqual(classSortKey('三班').slice(0, -1))
    expect(compareClassName('3班', '三班')).not.toBe(0)
    expect(compareClassName('三班', '4班')).toBeLessThan(0)
    expect(compareClassName('2班', '三班')).toBeLessThan(0)
    expect(compareClassName('', '一班')).toBeLessThan(0)
    expect(compareClassName('高一', '高一1班')).toBeLessThan(0)
    expect(compareClassName('高一1班', '高一2班')).toBeLessThan(0)
    expect(compareClassName('一百零一班', '一百零二班')).toBeLessThan(0)
    expect(compareClassName('实验班', '实验班')).toBe(0)
  })

  it.each([
    ['三年九班', '三年十班'],
    ['三年十一班', '三年二十班'],
    ['3班', '10班'],
    ['三年2班', '三年10班'],
    ['初一', '初二'],
    ['高一(9)班', '高一(10)班'],
    ['一年一班', '二年一班'],
    ['两班', '三班'],
    ['九十九班', '一百班'],
  ])('%s < %s', (a, b) => {
    expect(compareClassName(a, b)).toBeLessThan(0)
    expect(compareClassName(b, a)).toBeGreaterThan(0)
  })

  it('reads chinese numerals like the backend _cn_value', () => {
    expect(classSortKey('一零一班')).toEqual([
      [0, 101],
      [1, '班'],
      [-1, '一零一班'],
    ])
    expect(classSortKey('二零二六级')[0]).toEqual([0, 2026])
    expect(classSortKey('二十一班')[0]).toEqual([0, 21])
    expect(classSortKey('十班')[0]).toEqual([0, 10])
    expect(classSortKey('两百零五班')[0]).toEqual([0, 205])
    expect(classSortKey('一百零一班')[0]).toEqual([0, 101])
    expect(classSortKey('１０班')[0]).toEqual([0, 10])
    expect(classSortKey('高一(10)班').slice(0, -1)).toEqual([
      [1, '高'],
      [0, 1],
      [1, '('],
      [0, 10],
      [1, ')班'],
    ])
  })

  // L237:与后端 str.isdecimal() 同范围——任何文字的十进制数字(阿拉伯文 ٠–٩、天城文、全角 ０–９…)都按数值比;
  // 上标 ² / 带圈 ② 不是十进制数字,仍当文字(后端 int() 也不认)
  it('arabic-indic digits', () => {
    expect(classSortKey('٣班')[0]).toEqual([0, 3])
    expect(classSortKey('١٠班')[0]).toEqual([0, 10])
    expect(classSortKey('३班')[0]).toEqual([0, 3])
    // 混写的一段数字按位拼成一个数,与 Python int('1٢') 一致
    expect(classSortKey('1٢班')[0]).toEqual([0, 12])
    expect(compareClassName('٢班', '١٠班')).toBeLessThan(0)
    expect(sorted(['١٠班', '2班', '三班'])).toEqual(['2班', '三班', '١٠班'])
    expect(classSortKey('②班')).toEqual([
      [1, '②班'],
      [-1, '②班'],
    ])
    expect(classSortKey('高²班').slice(0, -1)).toEqual([[1, '高²班']])
  })

  it('falls back to plain text order when there is no number', () => {
    expect(sorted(['乙班', '甲班'])).toEqual(['乙班', '甲班'].sort())
    expect(classSortKey('实验班')).toEqual([
      [1, '实验班'],
      [-1, '实验班'],
    ])
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
