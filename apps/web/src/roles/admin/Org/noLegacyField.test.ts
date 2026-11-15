import { expect, it } from 'vitest'

// G-A1-3:组织架构页统一用 ui/field,旧的 Org/Field.tsx 已删,不许再回来
const orgFiles = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true })

it('has no local Field.tsx and no file imports it', () => {
  expect(Object.keys(orgFiles)).not.toContain('./Field.tsx')
  for (const [path, source] of Object.entries(orgFiles)) {
    expect(source, path).not.toMatch(/from '\.\/Field'/)
  }
})
