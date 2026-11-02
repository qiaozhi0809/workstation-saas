import type { ListResponse } from '@/shared/types/api'
import type {
  StudentImport, StudentImported, StudentInput, StudentProfile, StudentRecord, StudentSeat, TeacherNote,
} from '@/shared/types/student'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}`

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
  records: (classId: string) => api<ListResponse<StudentRecord>>('GET', `${base(classId)}/students/records`),
  create: (classId: string, input: StudentInput) =>
    api<StudentRecord>('POST', `${base(classId)}/students`, input),
  update: (classId: string, enrollmentId: string, input: StudentInput) =>
    api<StudentRecord>('PUT', `${base(classId)}/students/${encodeURIComponent(enrollmentId)}`, input),
  remove: (classId: string, enrollmentId: string) =>
    api<void>('DELETE', `${base(classId)}/students/${encodeURIComponent(enrollmentId)}`),
  importRows: (classId: string, body: StudentImport) =>
    api<StudentImported>('POST', `${base(classId)}/students/import`, body),
  exportRecords: (classId: string) =>
    api<ListResponse<StudentRecord>>('GET', `${base(classId)}/students/export`),
  saveMyNotes: (studentId: string, text: string) =>
    api<TeacherNote>('PUT', `/students/${encodeURIComponent(studentId)}/my-notes`, { text }),
}
