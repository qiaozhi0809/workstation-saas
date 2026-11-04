import { ApiError } from '@/shared/api/client'

export type StepKey = 'year' | 'classes' | 'students' | 'newClasses' | 'people' | 'preview'
export type Section = 'new_year' | 'classes' | 'students' | 'new_classes' | 'grade_heads'

/** 后端 400 UPGRADE_PLAN_INVALID 指出的出错位置 */
export interface Problem { section: Section | null; index: number | null; field: string | null; message: string }

const SECTION_STEP: Record<Section, StepKey> = {
  new_year: 'year', classes: 'classes', students: 'students', new_classes: 'newClasses', grade_heads: 'people',
}
const SECTIONS = Object.keys(SECTION_STEP)

export const stepOfSection = (s: Section): StepKey => SECTION_STEP[s]

export function problemOf(e: unknown): Problem | null {
  if (!(e instanceof ApiError) || e.code !== 'UPGRADE_PLAN_INVALID') return null
  const d = (typeof e.details === 'object' && e.details !== null ? e.details : {}) as Record<string, unknown>
  const section = typeof d.section === 'string' && SECTIONS.includes(d.section) ? (d.section as Section) : null
  return {
    section,
    index: typeof d.index === 'number' ? d.index : null,
    field: typeof d.field === 'string' ? d.field : null,
    message: e.message,
  }
}

export const isStale = (e: unknown): boolean => e instanceof ApiError && e.code === 'UPGRADE_PLAN_STALE'

/** 该行(或该字段)是否是当前问题所在 */
export const rowHit = (p: Problem | null, section: Section, index: number): boolean =>
  p?.section === section && p.index === index
export const fieldHit = (p: Problem | null, section: Section, index: number, field: string): boolean =>
  rowHit(p, section, index) && p?.field === field

// 对照 server/app/domain/years/cli.py::_DATA_LABELS 与回滚新增的几类
const DATA_LABELS: Record<string, string> = {
  class_boards: '看板改动 {} 处',
  seats: '座位调整 {} 处',
  class_roles: '班干部变动 {} 处',
  transfers: '学生转出 {} 人',
  grade_exams: '年级联考 {} 场',
  attendances: '考勤记录 {} 条',
  attendance_days: '已确认的考勤 {} 天',
  reviews: '点评 {} 条',
  exams: '考试 {} 场',
  seat_arrangements: '排座方案 {} 个',
  growth_records: '成长记录 {} 条',
  comments: '评语 {} 条',
  ai_chats: 'AI 对话 {} 个',
  new_students: '新增学生 {} 人',
}

export function dataLines(details: unknown): string[] {
  if (typeof details !== 'object' || details === null) return []
  return Object.entries(details as Record<string, unknown>).map(([k, v]) => {
    const label = DATA_LABELS[k]
    return label ? label.replace('{}', String(v)) : `${k}: ${String(v)}`
  })
}
