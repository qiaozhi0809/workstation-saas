/** 评语类型（与 http-contract 逐字段一致）。 */
export interface Comment {
  id: string
  /** 如 '2026-2027 第一学期' */
  semester: string
  /** 1–1000 字 */
  content: string
  generated_by_ai: boolean
  current_year: boolean
  /** 记录人姓名（账号删除后为 null） */
  created_by_name: string | null
  can_delete: boolean
  created_at: string
  /** 家长端是否可见 */
  parent_visible: boolean
  /** 调用者能否切换"给家长看"(往年评语只有有权限的人能改,L70) */
  can_share: boolean
}

export interface CommentInput {
  content: string
  generated_by_ai: boolean
}

/** items 1–80 项 */
export interface CommentBulk {
  items: { student_id: string; content: string }[]
  generated_by_ai: boolean
}
