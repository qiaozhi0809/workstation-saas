import { examsApi } from '@/shared/api/exams'
import { toast } from '@/shared/components/Toast'
import { downloadText, toCSV } from '@/shared/lib/csv'
import { examTable } from '@/shared/lib/grades'
import type { Exam, GradebookExam, ScoreSheet, ScoreValue } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { compareRoster } from './rosterOrder'

const show = (v: ScoreValue | undefined) => (v === undefined ? '' : v === null ? '缺考' : v)

export function scoresCsv(exam: Exam, sheet: ScoreSheet, roster: StudentSeat[]): string {
  const scores: GradebookExam['scores'] = {}
  for (const item of sheet.items) scores[item.enrollment_id] = item.scores
  const book: GradebookExam = { ...exam, scores }
  const seats = [...roster].sort(compareRoster)
  const byId = new Map(seats.map((s) => [s.enrollment_id, s]))
  // examTable 的排序是稳定的:先按学号、姓名排好,同分与无名次的人就保持这个顺序
  const rows = examTable(book, seats.map((s) => s.enrollment_id))
  const header = ['学号', '姓名', ...exam.subjects.map((s) => s.name), '总分', '排名']
  const body = rows.map((r) => {
    const seat = byId.get(r.id)!
    return [
      seat.student_no, seat.name,
      ...exam.subjects.map((s) => show(r.subs[s.name])),
      r.total, r.rank,
    ]
  })
  return toCSV([header, ...body])
}

/** 先调 exportSheet(服务端写审计,并返回全部科目),再下载 CSV。 */
export async function exportScores(classId: string, className: string, exam: Exam, roster: StudentSeat[]): Promise<void> {
  try {
    const sheet = await examsApi.exportSheet(classId, exam.id)
    downloadText(`${className}-${exam.name}-成绩.csv`, scoresCsv(sheet.exam, sheet, roster))
  } catch {
    toast('导出失败,请重试')
  }
}
