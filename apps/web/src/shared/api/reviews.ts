import type { Review, ReviewCreate, ReviewSummary } from '@/shared/types/review'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}/reviews`

export const reviewsApi = {
  list: (classId: string, opts?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (opts?.cursor !== undefined) qs.set('cursor', opts.cursor)
    if (opts?.limit !== undefined) qs.set('limit', String(opts.limit))
    const query = qs.toString()
    return api<{ items: Review[]; next_cursor: string | null }>(
      'GET',
      query ? `${base(classId)}?${query}` : base(classId),
    )
  },
  summary: (classId: string) => api<ReviewSummary>('GET', `${base(classId)}/summary`),
  create: (classId: string, body: ReviewCreate) =>
    api<{ items: Review[] }>('POST', base(classId), body),
  revoke: (classId: string, opId: string) =>
    api<{ op_id: string; revoked: number }>(
      'POST',
      `${base(classId)}/${encodeURIComponent(opId)}/revoke`,
    ),
}
