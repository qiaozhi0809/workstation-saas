import type { ReactNode, Ref } from 'react'
import type { DeskSize } from '@/shared/types/seating'
import type { StudentSeat } from '@/shared/types/student'

export type ClassroomMode =
  'daily' | 'attendance' | 'review' | 'grades' | 'seating' | 'overview' | 'mini'
export type IdleAction = 'look' | 'raise' | 'doze' | 'stretch'
export type TeacherAction = 'idle' | 'sip' | 'point'
export type Tone = 'amber' | 'red' | 'blue' | 'green' | 'coral' | 'gray'
export interface Cell {
  row: number
  col: number
}
export interface SeatAnchor {
  left: number
  top: number
  width: number
  height: number
} // 视口坐标
export interface SeatView {
  ghost?: boolean
  chip?: { text: string; tone: Tone }
  badge?: { text: string; tone: Tone; strong?: boolean }
  selected?: boolean
  /** 成绩名次档(1 = 前 20%):只换桌面顶面色,不进可访问名称 */
  tint?: 1 | 2 | 3 | 4 | 5
  /** 读屏补充说明(如名次档):只进座位的可访问描述,不进可访问名称、不画到图上 */
  description?: string
  locked?: boolean
}
export interface FloatFx {
  key: string
  enrollmentId: string
  text: string
  tone: 'plus' | 'minus'
}
export interface ClassroomEffects {
  idle?: Record<string, IdleAction> // enrollment_id → 动作
  spotlightId?: string | null
  pickedId?: string | null
  floats?: FloatFx[]
  teacher?: TeacherAction
}
export interface BoardData {
  leftTitle: string
  leftLines: string[]
  rightTitle: string
  rightLines: string[]
  screenTitle: string
  countdown: { label: string; days: number } | null
  stars: { name: string; points: number }[] // 最多显示 3 个
  birthdays: { name: string; date: string }[] // 'MM-DD',最多显示 3 个
  /** 本周之星开关关掉时为 true:连"本周之星"的牌子(标题)一起不画,不只是清空名单 */
  hideStars?: boolean
}
// 左翼前墙上"出勤"小牌的数据(只有汇总数,没有人名);present = 名单人数 - 请假 - 缺勤
export interface AttendanceBoardData {
  title: string
  present: number
  total: number
  leave: number
  absent: number
  late: number
}
export interface ClassroomViewportHandle {
  zoomIn(): void
  zoomOut(): void
  fit(): void
}
export interface ClassroomMapProps {
  rows: number
  cols: number
  deskSize?: DeskSize // 每桌几人,默认 2
  podium?: { left: number; right: number } // 讲台两侧座位数,默认 0 / 0
  seats: StudentSeat[]
  mode?: ClassroomMode
  teacher?: { figure: 'female' | 'male'; label: string }
  board?: BoardData
  attendanceBoard?: AttendanceBoardData // 给了就把左翼最靠近中央的一扇窗换成出勤小牌;mini / 不给时窗户照旧
  onAttendanceBoardVisibleChange?: (visible: boolean) => void // 小牌在适应(锁定)视图下是否完整落在舞台内
  views?: Record<string, SeatView> // enrollment_id → 外观
  highlight?: string[] // 仅 mini:这些注册 id 的座位画强调描边并显示姓名,其余占用座位只画桌面;其他模式忽略
  effects?: ClassroomEffects
  presenting?: boolean
  renderHoverCard?: (seat: StudentSeat) => ReactNode
  onSeatClick?: (seat: StudentSeat, anchor: SeatAnchor) => void
  onEmptySeatClick?: (cell: Cell) => void
  onSeatDrop?: (from: Cell, to: Cell) => void
  viewportRef?: Ref<ClassroomViewportHandle>
  zoomControls?: boolean // 舞台右下角显示缩放悬浮钮(缩小 / 适应 / 放大);mini 模式不显示
}
