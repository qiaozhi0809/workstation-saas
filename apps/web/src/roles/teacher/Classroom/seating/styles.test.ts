import { expect, it } from 'vitest'
import { findLegacyStyles } from '@/test/legacyStyles'

it('uses design tokens only', () => {
  const files = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})
