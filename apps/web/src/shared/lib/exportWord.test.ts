import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadText } from '@/shared/lib/csv'
import { exportWord } from './exportWord'

vi.mock('@/shared/lib/csv', () => ({ downloadText: vi.fn() }))

describe('exportWord', () => {
  beforeEach(() => vi.mocked(downloadText).mockClear())

  it('builds a .doc with BOM, SimSun and the title', () => {
    exportWord('家长会发言稿', '| a |\n| - |\n| 1 |')
    const [name, text, mime] = vi.mocked(downloadText).mock.calls[0]
    expect(name).toBe('家长会发言稿.doc')
    expect(mime).toBe('application/msword')
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('SimSun')
    expect(text).toContain('<table')
    expect(text).toContain('<h1>家长会发言稿</h1>')
    expect(text).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"')
  })

  it('sanitises file names', () => {
    exportWord('评语:王小一/期末', 'x')
    expect(vi.mocked(downloadText).mock.calls[0][0]).toBe('评语_王小一_期末.doc')
  })

  it('falls back for empty titles and truncates long ones', () => {
    exportWord('  ', 'x')
    exportWord('长'.repeat(80), 'x')
    expect(vi.mocked(downloadText).mock.calls[0][0]).toBe('AI 草稿.doc')
    expect(vi.mocked(downloadText).mock.calls[1][0]).toBe('长'.repeat(60) + '.doc')
  })

  // L96:文件名不能以空格收尾——截到 60 字时正好切在空格上,或标题本身首尾带空格 / 非法字符换成 _ 后留下空格
  it('never leaves leading or trailing spaces in the file name', () => {
    exportWord('长'.repeat(59) + ' 尾巴', 'x')
    exportWord('  期中 家长会 发言稿  ', 'x')
    exportWord(' 评语 : ', 'x')
    const names = vi.mocked(downloadText).mock.calls.map((c) => c[0])
    expect(names[0]).toBe('长'.repeat(59) + '.doc')
    expect(names[1]).toBe('期中 家长会 发言稿.doc')
    expect(names[2]).toBe('评语 _.doc')
    for (const n of names) expect(n.replace(/\.doc$/, '')).toBe(n.replace(/\.doc$/, '').trim())
  })
})
