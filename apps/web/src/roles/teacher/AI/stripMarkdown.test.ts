import { describe, expect, it } from 'vitest'
import { stripMarkdown } from './stripMarkdown'

describe('stripMarkdown', () => {
  it('removes markers, table pipes and extra blank lines', () => {
    expect(stripMarkdown('\n# 标题\n\n\n\n**粗体** > 引用 `code`\n| a | b |\n')).toBe('标题\n\n粗体 引用 code\na b')
  })
})
