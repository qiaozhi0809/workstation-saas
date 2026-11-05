import { describe, expect, it } from 'vitest'
import { aiLink, readAiLink } from './aiLink'

describe('aiLink', () => {
  it('round-trips aiLink and readAiLink', () => {
    const url = aiLink({ tpl: 'comment1', studentId: 's1', examId: 'e1', compareExamId: 'e0' })
    expect(url).toBe('/teacher/ai?tpl=comment1&stu=s1&exam=e1&vs=e0')
    expect(readAiLink(url.slice(url.indexOf('?')))).toEqual({
      tpl: 'comment1',
      stu: 's1',
      exam: 'e1',
      vs: 'e0',
    })
  })

  it('only includes given params', () => {
    expect(aiLink({ tpl: 'lesson' })).toBe('/teacher/ai?tpl=lesson')
  })

  it('ignores unknown templates', () => {
    expect(readAiLink('?tpl=nope&stu=s1')).toEqual({ tpl: null, stu: 's1', exam: null, vs: null })
    expect(readAiLink('')).toEqual({ tpl: null, stu: null, exam: null, vs: null })
  })
})
