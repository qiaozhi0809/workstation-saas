export interface ReviewReason {
  text: string
  delta: number
}

export interface Preferences {
  teacher_figure: 'female' | 'male'
  idle_animation: boolean
  review_reasons: ReviewReason[]
}
