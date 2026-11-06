import type { SubjectFull } from './grades'

/** 及格 / 优秀比例(对满分的比例,两位小数);判定"≥ 满分 × 比例" */
export interface Grading {
  pass_ratio: number
  good_ratio: number
}

/** 科目目录的学段键;年级的"小学 / 初中 / 高中"分别对应 primary / junior / senior */
export type Stage = 'primary' | 'junior' | 'senior'
export const STAGES: readonly Stage[] = ['primary', 'junior', 'senior']
export const STAGE_LABEL: Record<Stage, string> = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
}

/** 每个学段 1–20 门,科目名 1–10 字、不重复,满分 1–1000 的整数 */
export type SubjectCatalog = Record<Stage, SubjectFull[]>

export interface Meta {
  version: string
  school_name: string
  school_tz: string
}
