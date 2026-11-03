import type { LayoutDraft, LayoutPreview, LayoutSave, LayoutSaved, SeatingSave, SeatingSaved } from '@/shared/types/seating'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}`

export const seatingApi = {
  save: (classId: string, body: SeatingSave) => api<SeatingSaved>('PUT', `${base(classId)}/seating`, body),
  preview: (classId: string, body: LayoutDraft) => api<LayoutPreview>('POST', `${base(classId)}/layout/preview`, body),
  saveLayout: (classId: string, body: LayoutSave) => api<LayoutSaved>('PUT', `${base(classId)}/layout`, body),
}
