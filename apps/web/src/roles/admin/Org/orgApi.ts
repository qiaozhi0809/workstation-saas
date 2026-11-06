import { api } from '@/shared/api/client'

/** 选人候选:只含在用且有教师行的账号(后端 PersonBrief) */
export interface OrgPerson {
  user_id: string
  /** teachers.id:升级向导方案里的班主任用它,选择器据此高亮预填的老师(L55) */
  teacher_id: string
  name: string
  login_name: string
  subjects: string[]
}

const qs = (q: string) => {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const orgApi = {
  people: (q: string) => api<OrgPerson[]>('GET', `/admin/org/people${qs(q)}`),
}
