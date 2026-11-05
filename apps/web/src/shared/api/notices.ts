import type { AckInput, AckStats, Inbox } from '@/shared/types/admin'
import { api, authedFetch, toApiError } from './client'

const seg = encodeURIComponent

export const noticesApi = {
  inbox: (page: number) => api<Inbox>('GET', `/notices?page=${encodeURIComponent(String(page))}`),
  read: (id: string) => api<void>('POST', `/notices/${seg(id)}/read`),
  readAll: () => api<void>('POST', '/notices/read-all'),
  ack: (id: string, body: AckInput) => api<void>('POST', `/notices/${seg(id)}/ack`, body),
  acks: (id: string) => api<AckStats>('GET', `/notices/${seg(id)}/acks`),
  /** 带 Bearer 下载回执名单 CSV(令牌走请求头,不进 URL);非 2xx 抛 ApiError */
  exportAcks: async (id: string): Promise<Blob> => {
    const res = await authedFetch('GET', `/notices/${seg(id)}/acks/export`)
    if (!res.ok) throw await toApiError(res)
    return res.blob()
  },
}
