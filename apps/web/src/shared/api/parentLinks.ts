import type { ParentCreated, ParentInput, ParentOfStudent } from '@/shared/types/parent'
import { api } from './client'

const enc = encodeURIComponent

/** 班主任管家长(需要 parent.manage) */
export const parentLinksApi = {
  list: (sid: string) => api<ParentOfStudent[]>('GET', `/students/${enc(sid)}/parents`),
  create: (sid: string, body: ParentInput) =>
    api<ParentCreated>('POST', `/students/${enc(sid)}/parents`, body),
  setPrimary: (linkId: string) =>
    api<ParentOfStudent[]>('POST', `/parent-links/${enc(linkId)}/primary`),
  unlink: (linkId: string) => api<void>('DELETE', `/parent-links/${enc(linkId)}`),
  resetPassword: (linkId: string) =>
    api<{ temp_password: string }>('POST', `/parent-links/${enc(linkId)}/reset-password`),
}
