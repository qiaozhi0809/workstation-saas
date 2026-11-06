import { describe, expect, it } from 'vitest'
import { stripMarkdown } from './stripMarkdown'

describe('stripMarkdown', () => {
  it('removes markers, table pipes and extra blank lines', () => {
    expect(stripMarkdown('\n# 标题\n\n\n\n**粗体** > 引用 `code`\n| a | b |\n')).toBe(
      '标题\n\n粗体 引用 code\na b',
    )
  })

  // L17:分隔线(---、***、___,含中间带空格的写法)是记号不是内容,不能留在成长记录里
  it('drops horizontal rules but keeps list dashes and in-text hyphens', () => {
    expect(stripMarkdown('上文\n\n---\n\n下文\n* * *\n___\n- 要点一\n2026-11-02 开会')).toBe(
      '上文\n\n下文\n- 要点一\n2026-11-02 开会',
    )
  })
})
