export interface ReviewReason {
  text: string
  delta: number
}

/** 各语境首次引导的完成时间(ISO);只记录当前用户拥有的语境 */
export interface Onboarded {
  teacher?: string
  parent?: string
  admin?: string
}

export interface Preferences {
  teacher_figure: 'female' | 'male'
  idle_animation: boolean
  review_reasons: ReviewReason[]
  /** GET 总返回;PUT 时省略 = 不动,给了就按键合并(旧后端没有这个字段) */
  onboarded?: Onboarded
}
