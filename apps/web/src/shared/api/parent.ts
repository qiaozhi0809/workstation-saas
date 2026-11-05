import type { Contact } from '@/shared/types/student'
import type {
  ParentChild,
  ParentComment,
  ParentExamDetail,
  ParentExamItem,
  ParentGrowthRecord,
  ParentProfile,
  ParentReviewPage,
  ParentToday,
} from '@/shared/types/parent'
import { api } from './client'

const base = (sid: string) => `/parent/children/${encodeURIComponent(sid)}`

export const parentApi = {
  children: () => api<ParentChild[]>('GET', '/parent/children'),
  /** date 省略 = 学校今天;只能是今天或往前 30 天内 */
  today: (sid: string, date?: string) =>
    api<ParentToday>('GET', `${base(sid)}/today${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  profile: (sid: string) => api<ParentProfile>('GET', `${base(sid)}/profile`),
  saveContacts: (sid: string, contacts: Contact[]) =>
    api<ParentProfile>('PUT', `${base(sid)}/contacts`, { contacts }),
  growth: (sid: string) =>
    api<{ items: ParentGrowthRecord[] }>('GET', `${base(sid)}/growth-records`),
  comments: (sid: string) => api<{ items: ParentComment[] }>('GET', `${base(sid)}/comments`),
  reviews: (sid: string, cursor?: string) => {
    const qs = new URLSearchParams()
    if (cursor !== undefined) qs.set('cursor', cursor)
    const query = qs.toString()
    return api<ParentReviewPage>('GET', `${base(sid)}/reviews${query ? `?${query}` : ''}`)
  },
  exams: (sid: string) => api<ParentExamItem[]>('GET', `${base(sid)}/exams`),
  exam: (sid: string, examId: string) =>
    api<ParentExamDetail>('GET', `${base(sid)}/exams/${encodeURIComponent(examId)}`),
}
