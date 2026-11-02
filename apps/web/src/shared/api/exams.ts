import type { ListResponse } from '@/shared/types/api'
import type {
  Exam, ExamInput, Gradebook, ScoreCell, ScoreSheet, SubjectFull,
} from '@/shared/types/grades'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}`
const exam = (classId: string, examId: string) => `${base(classId)}/exams/${encodeURIComponent(examId)}`

export const examsApi = {
  subjects: (classId: string) => api<ListResponse<SubjectFull>>('GET', `${base(classId)}/subjects`),
  list: (classId: string) => api<ListResponse<Exam>>('GET', `${base(classId)}/exams`),
  create: (classId: string, input: ExamInput) => api<Exam>('POST', `${base(classId)}/exams`, input),
  update: (classId: string, examId: string, input: ExamInput) =>
    api<Exam>('PUT', exam(classId, examId), input),
  remove: (classId: string, examId: string) => api<void>('DELETE', exam(classId, examId)),
  sheet: (classId: string, examId: string) => api<ScoreSheet>('GET', `${exam(classId, examId)}/scores`),
  saveScores: (classId: string, examId: string, cells: ScoreCell[]) =>
    api<{ updated: number }>('PUT', `${exam(classId, examId)}/scores`, { cells }),
  exportSheet: (classId: string, examId: string) =>
    api<ScoreSheet>('GET', `${exam(classId, examId)}/export`),
  gradebook: (classId: string) => api<Gradebook>('GET', `${base(classId)}/gradebook`),
}
