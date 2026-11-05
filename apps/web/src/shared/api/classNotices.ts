import type { ClassNoticeInput, NoticeSent } from '@/shared/types/admin'
import { api } from './client'

const seg = encodeURIComponent

/** 班主任发给本班家长的通知(需要 class.notice) */
export const classNoticesApi = {
  list: (classId: string, page: number) =>
    api<{ items: NoticeSent[]; total: number }>('GET', `/classes/${seg(classId)}/notices?page=${seg(String(page))}`),
  send: (classId: string, body: ClassNoticeInput) =>
    api<NoticeSent>('POST', `/classes/${seg(classId)}/notices`, body),
  recall: (classId: string, id: string) =>
    api<NoticeSent>('POST', `/classes/${seg(classId)}/notices/${seg(id)}/recall`),
}
