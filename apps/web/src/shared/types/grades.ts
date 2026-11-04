export type ExamType = '月考' | '期中' | '期末' | '周测' | '单元测' | '模拟考' | '其他'
export const EXAM_TYPES: readonly ExamType[] = ['月考', '期中', '期末', '周测', '单元测', '模拟考', '其他']

export interface SubjectFull { name: string; full: number }

export interface Exam {
  id: string; name: string; exam_type: ExamType; date: string
  subjects: SubjectFull[]
  grade_exam_id: string | null
  created_by_me: boolean
  progress: { entered: number; total: number }
}
export interface ExamInput { name: string; exam_type: ExamType; date: string; subjects: SubjectFull[] }

export type ScoreValue = number | null
export interface ScoreSheet {
  exam: Exam
  items: { enrollment_id: string; scores: Record<string, ScoreValue> }[]
}
export interface ScoreCell { enrollment_id: string; subject: string; value: number | 'absent' | null }
export interface GradebookExam extends Exam {
  scores: Record<string, Record<string, ScoreValue>>
}
export interface Gradebook { exams: GradebookExam[] }
