import { ATTENDANCE_TONE, TONE_FILL, TONE_TEXT, scoreTone } from './tone'

describe('tone', () => {
  it('maps attendance statuses', () => {
    expect(ATTENDANCE_TONE).toEqual({ present: 'success', leave: 'warning', absent: 'danger', late: 'info' })
  })
  it('scoreTone', () => {
    expect(scoreTone(2)).toBe('success')
    expect(scoreTone(-1)).toBe('danger')
    expect(scoreTone(0)).toBe('neutral')
  })
  it('class maps', () => {
    expect(TONE_TEXT.danger).toBe('text-destructive')
    expect(TONE_TEXT.neutral).toBe('text-muted-foreground')
    expect(TONE_FILL.danger).toBe('bg-destructive')
    expect(TONE_FILL.success).toBe('bg-success')
  })
})
