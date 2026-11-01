import type { SeatingSave, SeatingSaved } from '@/shared/types/seating'
import { api } from './client'

export const seatingApi = {
  save: (classId: string, body: SeatingSave) =>
    api<SeatingSaved>('PUT', `/classes/${encodeURIComponent(classId)}/seating`, body),
}
