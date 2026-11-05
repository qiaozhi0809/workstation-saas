/** AI 助手类型（与 http-contract 逐字段一致）。 */
export interface AiStatus {
  configured: boolean
  /** 如 'DeepSeek · deepseek-flash'；未配置为 null */
  provider_label: string | null
  /** 学校强制隐去姓名 */
  mask_forced: boolean
}

export type AiTemplateId =
  | 'lesson'
  | 'ppt'
  | 'homework'
  | 'meeting'
  | 'activity'
  | 'summary'
  | 'notice'
  | 'parent'
  | 'pmeeting'
  | 'comments'
  | 'report'
  | 'talk'
  | 'birthday'
  | 'comment1'
  | 'parent-batch'

export type AiCategory = 'rec' | 'teach' | 'manage' | 'home' | 'grow'

export type AiFieldType =
  'text' | 'textarea' | 'select' | 'check' | 'student' | 'students' | 'exam' | 'exam0'

export interface AiField {
  key: string
  type: AiFieldType
  label: string
  required: boolean
  /** 仅 select */
  options?: string[]
  /** select 的默认选项 / check 的默认值 / text 的默认文字 */
  default?: string | boolean
  placeholder?: string
}

export interface AiTemplate {
  id: AiTemplateId
  cat: Exclude<AiCategory, 'rec'>
  title: string
  desc: string
  rec: boolean
  hidden: boolean
  batch: boolean
  fields: AiField[]
  /** 调用者在本班能否使用 */
  available: boolean
  /** 如 '仅班主任可用'、'需要查看成绩的权限' */
  unavailable_reason: string | null
}

export interface AiTemplates {
  categories: { id: AiCategory; label: string }[]
  items: AiTemplate[]
}

export type AiValue = string | boolean | string[] | null

export interface AiRequest {
  class_id: string
  /** null = 自由对话 */
  template_id: AiTemplateId | null
  /** 模板字段值（student / exam 为 id；students 为 student_id 数组；exam0 为 id 或 null=不对比）；自由对话传 {} */
  values: Record<string, AiValue>
  /** 自由对话必填，去首尾空格后 1–4000 字 */
  text?: string
  /** 只用于自由对话 */
  context?: { class: boolean; student_id: string | null; exam_id: string | null }
  /** 学校强制时服务端一律按 true */
  mask: boolean
}

export interface AiPrompt {
  prompt: string
  /** 只在隐去姓名时非空，按编号升序 */
  mapping: { code: string; name: string }[]
}

export type AiMessageStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  /** 真名文本（用户消息为“展示文字”） */
  content: string
  status: AiMessageStatus
  error: string | null
  created_at: string
}

export type AiItemStatus = 'wait' | 'run' | 'done' | 'err'

export interface AiBatchItem {
  id: string
  student_id: string
  student_name: string
  /** 退步同学家长沟通：'退步 6 名'；期末评语为 null */
  note: string | null
  status: AiItemStatus
  content: string
  error: string | null
}

export interface AiChatSummary {
  id: string
  title: string
  template_id: AiTemplateId | null
  updated_at: string
}

export interface AiChat extends AiChatSummary {
  class_id: string
  /** 单个学生的对话 */
  student_id: string | null
  /** 期末评语 / 个人评语 → 'comment' */
  save_as: 'comment' | null
  mask: boolean
  /** 批量对话：不能追问 */
  batch_only: boolean
  /** 旧 → 新 */
  messages: AiMessage[]
  /** 批量对话按 position；其余为 [] */
  items: AiBatchItem[]
}

/** text：追问（去首尾空格后 1–4000 字）；regenerate：重做最后一条回复 */
export interface AiReplyInput {
  text?: string
  regenerate?: boolean
}
