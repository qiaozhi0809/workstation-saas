import type { ListResponse } from '@/shared/types/api'
import type { StudentProfile, StudentSeat } from '@/shared/types/student'
import { api } from './client'

export const studentsApi = {
  listInClass: (classId: string) =>
    api<ListResponse<StudentSeat>>('GET', `/classes/${encodeURIComponent(classId)}/students`),
  detail: (id: string) => api<StudentProfile>('GET', `/students/${encodeURIComponent(id)}`),
  setClassRole: (classId: string, enrollmentId: string, classRole: string | null) =>
    api<{ enrollment_id: string; class_role: string | null }>(
      'PUT',
      `/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(enrollmentId)}/class-role`,
      { class_role: classRole },
    ),
}
