export interface Review {
  id: string
  op_id: string
  enrollment_id: string
  category: 'individual' | 'whole_class'
  reason_text: string
  score_delta: number
  subject: string | null
  given_at: string
  given_by_me: boolean
  student_name: string
  transferred: boolean
}

export interface ReviewCreate {
  op_id: string
  category: 'individual' | 'whole_class'
  enrollment_ids?: string[]
  reason_text: string
  score_delta: number
  subject?: string | null
}

export interface ReviewTotals {
  enrollment_id: string
  total: number
  week: number
  plus_count: number
  minus_count: number
}

export interface ReviewSummary {
  week_start: string
  items: ReviewTotals[]
}
