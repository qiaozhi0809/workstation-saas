import type { Review, ReviewCreate, ReviewSummary } from '@/shared/types/review'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}/reviews`

export interface ReviewPage {
  items: Review[]
  next_cursor: string | null
}

export const reviewsApi = {
  list: (classId: string, opts?: { cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (opts?.cursor !== undefined) qs.set('cursor', opts.cursor)
    if (opts?.limit !== undefined) qs.set('limit', String(opts.limit))
    const query = qs.toString()
    return api<ReviewPage>(
      'GET',
      query ? `${base(classId)}?${query}` : base(classId),
    )
  },
  /** 只看某个学生（enrollment）的点评，学生档案用 */
  listForStudent: (classId: string, enrollmentId: string, limit = 40) => {
    const qs = new URLSearchParams({ enrollment_id: enrollmentId, limit: String(limit) })
    return api<ReviewPage>('GET', `${base(classId)}?${qs.toString()}`)
  },
  summary: (classId: string) => api<ReviewSummary>('GET', `${base(classId)}/summary`),
  create: (classId: string, body: ReviewCreate) =>
    api<{ items: Review[] }>('POST', base(classId), body),
  revoke: (classId: string, opId: string) =>
    api<{ op_id: string; revoked: number }>(
      'POST',
      `${base(classId)}/${encodeURIComponent(opId)}/revoke`,
    ),
  /** 撤销单条点评（只撤这一行，仅给分人可用） */
  revokeItem: (classId: string, reviewId: string) =>
    api<{ review_id: string; revoked: number }>(
      'POST',
      `${base(classId)}/items/${encodeURIComponent(reviewId)}/revoke`,
    ),
}
