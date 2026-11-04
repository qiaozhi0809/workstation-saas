import type { Inbox } from '@/shared/types/admin'
import { api } from './client'

export const noticesApi = {
  inbox: (page: number) => api<Inbox>('GET', `/notices?page=${encodeURIComponent(String(page))}`),
  read: (id: string) => api<void>('POST', `/notices/${encodeURIComponent(id)}/read`),
  readAll: () => api<void>('POST', '/notices/read-all'),
}
