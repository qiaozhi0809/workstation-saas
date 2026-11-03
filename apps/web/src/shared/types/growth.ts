/** 成长记录类型（与 http-contract 逐字段一致）。 */
export type GrowthType = '表扬' | '谈话' | '家访' | '获奖' | '提醒' | '其他'

/** 下拉选项顺序 */
export const GROWTH_TYPES: readonly GrowthType[] = ['表扬', '谈话', '家访', '获奖', '提醒', '其他']

export interface GrowthRecord {
  id: string
  type: GrowthType
  /** 'YYYY-MM-DD' */
  date: string
  /** 1–500 字 */
  content: string
  /** 记录时所在学年 / 班级 */
  academic_year_name: string
  class_name: string
  /** 是否本学年（往年记录只读） */
  current_year: boolean
  /** 记录人姓名（账号删除后为 null） */
  created_by_name: string | null
  can_delete: boolean
  created_at: string
}

/** content 去首尾空格后 1–500 字 */
export interface GrowthInput {
  type: GrowthType
  date: string
  content: string
}
