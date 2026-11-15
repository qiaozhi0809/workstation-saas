import { cn } from './utils'

describe('cn', () => {
  it('shadow-none replaces shadow-surface', () => {
    expect(cn('rounded-lg shadow-surface', 'shadow-none')).toBe('rounded-lg shadow-none')
  })

  it('shadow-overlay replaces shadow-none', () => {
    expect(cn('shadow-none', 'shadow-overlay')).toBe('shadow-overlay')
  })

  it('shadow-overlay replaces shadow-surface', () => {
    expect(cn('shadow-surface', 'shadow-overlay')).toBe('shadow-overlay')
  })

  it('still merges ordinary conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
