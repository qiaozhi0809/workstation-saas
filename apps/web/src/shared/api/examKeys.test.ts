import { describe, expect, it } from 'vitest'
import { examKeys } from './examKeys'

// L273:老师端考试查询键只在 examKeys.ts 定义;联考失效(roles/admin/GradeExams/teacherCache.ts)与各页 useQuery 共用,
// 键的形状钉死,改键名时这里先红
describe('examKeys', () => {
  it('pins the four teacher-side exam query keys', () => {
    expect(examKeys.list('c1')).toEqual(['exams', 'c1'])
    expect(examKeys.gradebook('c1')).toEqual(['gradebook', 'c1'])
    expect(examKeys.subjects('c1')).toEqual(['class-subjects', 'c1'])
    expect(examKeys.sheet('c1', 'x1')).toEqual(['score-sheet', 'c1', 'x1'])
  })

  it('scopes every key by class so one class never invalidates another', () => {
    for (const key of [examKeys.list('c2'), examKeys.gradebook('c2'), examKeys.subjects('c2')])
      expect(key[1]).toBe('c2')
    expect(examKeys.sheet('c2', 'x9').slice(1)).toEqual(['c2', 'x9'])
  })
})
