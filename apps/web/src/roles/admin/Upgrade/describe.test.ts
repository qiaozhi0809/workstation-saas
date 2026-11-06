import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ClassPreview } from '@/shared/types/admin'
import { describeClass } from './describe'

const cp = (o: Partial<ClassPreview>): ClassPreview => ({
  from_name: '三年一班',
  action: 'promote',
  to_label: '四年级 一班',
  teacher_name: '李老师',
  follow: 38,
  repeat_in: 0,
  repeat_out: 1,
  leave: 1,
  graduate: 0,
  ...o,
})

describe('describeClass', () => {
  it('ClassPreview.action 只有三个已知值(L53),tsc 据此证明 switch 无遗漏', () => {
    expectTypeOf<ClassPreview['action']>().toEqualTypeOf<'promote' | 'graduate' | 'new'>()
  })

  it.each([
    [cp({}), '三年一班 → 四年级 一班,班主任:李老师,随班 38 人'],
    [cp({ teacher_name: null, follow: 0 }), '三年一班 → 四年级 一班,班主任:未定,随班 0 人'],
    [cp({ from_name: '六年一班', action: 'graduate', graduate: 40 }), '六年一班 毕业,毕业 40 人'],
    [
      cp({ from_name: '一年二班', action: 'new', to_label: '一年级 二班' }),
      '新建班 一年级 二班(一年二班),班主任:李老师',
    ],
  ])('describes %o', (row, text) => {
    expect(describeClass(row)).toBe(text)
  })
})
