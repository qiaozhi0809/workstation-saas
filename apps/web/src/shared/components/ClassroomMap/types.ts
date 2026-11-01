import type { ReactNode, Ref } from 'react'
import type { StudentSeat } from '@/shared/types/student'

export type ClassroomMode = 'daily' | 'attendance' | 'review' | 'seating' | 'overview' | 'mini'
export type IdleAction = 'look' | 'raise' | 'doze' | 'stretch'
export type TeacherAction = 'idle' | 'sip' | 'point'
export type Tone = 'amber' | 'red' | 'blue' | 'green' | 'coral' | 'gray'
export interface Cell { row: number; col: number }
export interface SeatAnchor { left: number; top: number; width: number; height: number }  // 视口坐标
export interface SeatView {
  ghost?: boolean
  chip?: { text: string; tone: Tone }
  badge?: { text: string; tone: Tone; strong?: boolean }
  selected?: boolean
  locked?: boolean
}
export interface FloatFx { key: string; enrollmentId: string; text: string; tone: 'plus' | 'minus' }
export interface ClassroomEffects {
  idle?: Record<string, IdleAction>      // enrollment_id → 动作
  spotlightId?: string | null
  pickedId?: string | null
  floats?: FloatFx[]
  teacher?: TeacherAction
}
export interface BoardData {
  leftTitle: string; leftLines: string[]; rightTitle: string; rightLines: string[]
  screenTitle: string
  countdown: { label: string; days: number } | null
  stars: { name: string; points: number }[]       // 最多显示 3 个
  birthdays: { name: string; date: string }[]      // 'MM-DD',最多显示 3 个
}
export interface ClassroomViewportHandle { zoomIn(): void; zoomOut(): void; fit(): void }
export interface ClassroomMapProps {
  rows: number
  cols: number
  seats: StudentSeat[]
  mode?: ClassroomMode
  teacher?: { figure: 'female' | 'male'; label: string }
  board?: BoardData
  views?: Record<string, SeatView>       // enrollment_id → 外观
  effects?: ClassroomEffects
  presenting?: boolean
  renderHoverCard?: (seat: StudentSeat) => ReactNode
  onSeatClick?: (seat: StudentSeat, anchor: SeatAnchor) => void
  onEmptySeatClick?: (cell: Cell) => void
  onSeatDrop?: (from: Cell, to: Cell) => void
  viewportRef?: Ref<ClassroomViewportHandle>
}
