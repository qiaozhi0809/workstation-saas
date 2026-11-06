import type { Stage as StageLabel } from '@/shared/types/admin'
import type { Stage } from '@/shared/types/school'

const BY_LABEL: Record<StageLabel, Stage> = { 小学: 'primary', 初中: 'junior', 高中: 'senior' }

/** 与后端 exams/subjects.py::stage_of 同规则:按年级名推断学段 */
export function stageOfGradeName(name: string): Stage {
  if (name.includes('高')) return 'senior'
  if (name.includes('初') || [...'七八九'].some((c) => name.includes(c))) return 'junior'
  if (name.includes('年级') && [...'一二三四五六'].some((c) => name.includes(c))) return 'primary'
  return 'junior'
}

/** 年级显式设了学段(/admin/grades 的 effective_stage)就用它,否则按名字推断 */
export function catalogStage(label: StageLabel | null | undefined, name: string): Stage {
  return label ? BY_LABEL[label] : stageOfGradeName(name)
}
