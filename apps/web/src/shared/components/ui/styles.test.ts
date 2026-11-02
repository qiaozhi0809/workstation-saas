import { findLegacyStyles } from '@/test/legacyStyles'

it('ui primitives use design tokens only', () => {
  const files = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})
