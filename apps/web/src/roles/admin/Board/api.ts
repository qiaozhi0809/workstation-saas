import { api } from '@/shared/api/client'
import type { BoardClass } from '@/shared/types/admin'

export interface BoardClassDetail extends BoardClass {
  absentees: {
    student_id: string
    name: string
    status: 'leave' | 'absent'
    reason: string | null
  }[]
}

export const boardClassApi = {
  detail: (classId: string) =>
    api<BoardClassDetail>('GET', `/admin/board/classes/${encodeURIComponent(classId)}`),
}
