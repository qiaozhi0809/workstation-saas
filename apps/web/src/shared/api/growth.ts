import type { GrowthInput, GrowthRecord } from '@/shared/types/growth'
import { api } from './client'

const enc = encodeURIComponent

export const growthApi = {
  list: (studentId: string) =>
    api<{ items: GrowthRecord[] }>('GET', `/students/${enc(studentId)}/growth-records`),
  create: (studentId: string, body: GrowthInput) =>
    api<GrowthRecord>('POST', `/students/${enc(studentId)}/growth-records`, body),
  remove: (id: string) => api<void>('DELETE', `/growth-records/${enc(id)}`),
}
