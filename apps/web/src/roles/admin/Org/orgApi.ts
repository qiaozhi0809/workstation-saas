import { api } from '@/shared/api/client'

/** 选人候选:只含在用且有教师行的账号 */
export interface OrgPerson { user_id: string; name: string; login_name: string; subjects: string[] }

const qs = (q: string) => {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const orgApi = {
  people: (q: string) => api<OrgPerson[]>('GET', `/admin/org/people${qs(q)}`),
}
