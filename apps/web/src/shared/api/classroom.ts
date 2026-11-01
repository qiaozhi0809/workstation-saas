import type { Board, ClassroomSummary } from '@/shared/types/classroom'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}`

export const classroomApi = {
  summary: (classId: string) => api<ClassroomSummary>('GET', `${base(classId)}/classroom`),
  saveBoard: (classId: string, board: Board) => api<Board>('PUT', `${base(classId)}/board`, board),
}
