import { describe, expect, it } from 'vitest'
import { ackSpecError, normalizeAck, optionsError } from './ackSpec'

const choice = (options: string[]) => ({ kind: 'choice' as const, options, allow_note: false })

describe('ackSpec', () => {
  it('tells an empty option apart from too few options, like AckSettings does (L89)', () => {
    // 够 2 个有效选项但有一个空着:是"空",不是"少"
    expect(ackSpecError(choice(['a', 'b', '']), null)).toBe('选项不能为空')
    expect(ackSpecError(choice(['a', 'b', '  ']), null)).toBe('选项不能为空')
    // 有效选项不足 2 个(空的不算):是"少"
    expect(ackSpecError(choice(['a']), null)).toBe('至少要 2 个选项')
    expect(ackSpecError(choice(['a', '']), null)).toBe('至少要 2 个选项')
    expect(ackSpecError(choice(['', '']), null)).toBe('至少要 2 个选项')
    expect(ackSpecError(choice(['a', 'b', 'c', 'd', 'e', 'f']), null)).toBe('最多 5 个选项')
    expect(ackSpecError(choice(['a', ' a ']), null)).toBe('选项不能重复')
    expect(
      ackSpecError({ kind: 'choice', options: ['参加', '不参加'], allow_note: true }, null),
    ).toBeNull()
  })

  it('optionsError is the single source both ackSpecError and AckSettings use', () => {
    expect(optionsError(['去', '不去', ''])).toBe('选项不能为空')
    expect(optionsError(['去', ''])).toBe('至少要 2 个选项')
    expect(optionsError(['去', '去'])).toBe('选项不能重复')
    expect(optionsError(['去', '不去'])).toBeNull()
  })
  it('rejects past deadline but ignores it for none', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(ackSpecError({ kind: 'confirm' }, past)).toBe('截止时间要晚于现在')
    expect(ackSpecError({ kind: 'none' }, past)).toBeNull()
  })
  it('normalizes: trims options, drops deadline for none', () => {
    const future = new Date(Date.now() + 3.6e6).toISOString()
    expect(
      normalizeAck({ kind: 'choice', options: [' 是 ', '否'], allow_note: false }, future),
    ).toEqual({
      ack: { kind: 'choice', options: ['是', '否'], allow_note: false },
      ack_deadline: future,
    })
    expect(normalizeAck({ kind: 'none' }, future)).toEqual({
      ack: { kind: 'none' },
      ack_deadline: null,
    })
  })
})
