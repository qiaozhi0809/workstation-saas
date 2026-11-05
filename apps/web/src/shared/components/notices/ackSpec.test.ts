import { describe, expect, it } from 'vitest'
import { ackSpecError, normalizeAck } from './ackSpec'

describe('ackSpec', () => {
  it('rejects empty, duplicate and too-few options', () => {
    expect(ackSpecError({ kind: 'choice', options: ['a', 'b', ''], allow_note: false }, null)).toBe(
      '至少要 2 个选项',
    )
    expect(ackSpecError({ kind: 'choice', options: ['a', ' a '], allow_note: false }, null)).toBe(
      '选项不能重复',
    )
    expect(
      ackSpecError({ kind: 'choice', options: ['参加', '不参加'], allow_note: true }, null),
    ).toBeNull()
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
