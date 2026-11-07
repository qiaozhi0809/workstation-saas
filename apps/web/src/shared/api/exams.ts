import type { ListResponse } from '@/shared/types/api'
import type {
  Exam,
  ExamInput,
  Gradebook,
  ScoreCell,
  ScoreSheet,
  SubjectFull,
} from '@/shared/types/grades'
import { api } from './client'

const base = (classId: string) => `/classes/${encodeURIComponent(classId)}`
const exam = (classId: string, examId: string) =>
  `${base(classId)}/exams/${encodeURIComponent(examId)}`

/**
 * 老师端考试相关的查询键(L273):成绩页 / 导入 / 自动保存按它取和失效,
 * 联考改动后的老师端缓存失效(roles/admin/GradeExams/teacherCache.ts)也用同一张表,不再靠人工对齐字面量。
 */
export const examKeys = {
  /** 考试列表 */
  list: (classId: string) => ['exams', classId] as const,
  /** 成绩册(分析页、教室成绩模式、侧边面板共用) */
  gradebook: (classId: string) => ['gradebook', classId] as const,
  /** 班级科目表 */
  subjects: (classId: string) => ['class-subjects', classId] as const,
  /** 某场考试的成绩单 */
  sheet: (classId: string, examId: string) => ['score-sheet', classId, examId] as const,
}

export const examsApi = {
  subjects: (classId: string) => api<ListResponse<SubjectFull>>('GET', `${base(classId)}/subjects`),
  /** 把学校目录里该班还没有的科目追加到班级科目表末尾(已有的不改满分),返回补齐后的全部科目 */
  fillFromCatalog: (classId: string) =>
    api<SubjectFull[]>('POST', `${base(classId)}/subjects/fill-from-catalog`),
  list: (classId: string) => api<ListResponse<Exam>>('GET', `${base(classId)}/exams`),
  create: (classId: string, input: ExamInput) => api<Exam>('POST', `${base(classId)}/exams`, input),
  update: (classId: string, examId: string, input: ExamInput) =>
    api<Exam>('PUT', exam(classId, examId), input),
  remove: (classId: string, examId: string) => api<void>('DELETE', exam(classId, examId)),
  sheet: (classId: string, examId: string) =>
    api<ScoreSheet>('GET', `${exam(classId, examId)}/scores`),
  saveScores: (classId: string, examId: string, cells: ScoreCell[]) =>
    api<{ updated: number }>('PUT', `${exam(classId, examId)}/scores`, { cells }),
  exportSheet: (classId: string, examId: string) =>
    api<ScoreSheet>('GET', `${exam(classId, examId)}/export`),
  gradebook: (classId: string) => api<Gradebook>('GET', `${base(classId)}/gradebook`),
}
