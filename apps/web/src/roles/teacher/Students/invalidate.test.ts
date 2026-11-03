import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidateRosterQueries } from './invalidate'

describe('invalidateRosterQueries', () => {
  it('refreshes the class list and the classroom map so auto layout changes show up', async () => {
    const qc = new QueryClient()
    for (const key of [['my-classes'], ['classroom', 'c1'], ['class-students', 'c1']]) qc.setQueryData(key, {})
    await invalidateRosterQueries(qc)
    expect(qc.getQueryState(['my-classes'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['classroom', 'c1'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['class-students', 'c1'])?.isInvalidated).toBe(true)
  })
})
