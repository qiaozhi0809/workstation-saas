import type { AiTemplateId } from '@/shared/types/ai'

/** 全部模板编号;`satisfies` 保证每项都属于 AiTemplateId(漏改类型时编译报错) */
const TEMPLATE_IDS = [
  'lesson', 'ppt', 'homework', 'meeting', 'activity', 'summary', 'notice', 'parent',
  'pmeeting', 'comments', 'report', 'talk', 'birthday', 'comment1', 'parent-batch',
] as const satisfies readonly AiTemplateId[]

/** 其他页面跳到 AI 助手并预选模板 / 学生 / 考试(学生参数叫 stu,避开档案抽屉的 student) */
export function aiLink(p: {
  tpl: AiTemplateId
  studentId?: string
  examId?: string
  compareExamId?: string
}): string {
  const q = new URLSearchParams({ tpl: p.tpl })
  if (p.studentId) q.set('stu', p.studentId)
  if (p.examId) q.set('exam', p.examId)
  if (p.compareExamId) q.set('vs', p.compareExamId)
  return `/teacher/ai?${q.toString()}`
}

/** 读取 aiLink 生成的查询串;未知模板编号视为 null */
export function readAiLink(search: string): {
  tpl: AiTemplateId | null
  stu: string | null
  exam: string | null
  vs: string | null
} {
  const q = new URLSearchParams(search)
  const tpl = q.get('tpl')
  return {
    tpl: (TEMPLATE_IDS as readonly string[]).includes(tpl ?? '') ? (tpl as AiTemplateId) : null,
    stu: q.get('stu'),
    exam: q.get('exam'),
    vs: q.get('vs'),
  }
}
