import type { MiniSeatMap } from '@/shared/types/parent'
import type { StudentSeat } from '@/shared/types/student'

// 家长端迷你教室:后端只给坐标,这里补成 ClassroomMap 吃的座位;别人的座位匿名,孩子的座位带姓名并高亮
export function seatsFromMiniMap(
  map: MiniSeatMap,
  child: {
    enrollment_id: string
    name: string
    gender: string | null
    avatar_seed?: string | null
  },
): { seats: StudentSeat[]; highlight: string[] } {
  const { mine } = map
  const seats = map.occupied.map(({ row, col }): StudentSeat => {
    const isMine = !!mine && mine.row === row && mine.col === col
    return {
      enrollment_id: isMine ? child.enrollment_id : `seat:${row}:${col}`,
      student_id: '',
      name: isMine ? child.name : '',
      mk: '',
      seat_row: row,
      seat_col: col,
      avatar_seed: isMine ? (child.avatar_seed ?? null) : null,
      gender: isMine ? child.gender : null,
      student_no: null,
      birthdate: null,
      class_role: null,
      seat_locked: false,
    }
  })
  // 契约保证 mine ∈ occupied;万一缺了也补上孩子的座位,不丢高亮
  if (mine && !seats.some((s) => s.enrollment_id === child.enrollment_id)) {
    seats.push({
      enrollment_id: child.enrollment_id,
      student_id: '',
      name: child.name,
      mk: '',
      seat_row: mine.row,
      seat_col: mine.col,
      avatar_seed: child.avatar_seed ?? null,
      gender: child.gender,
      student_no: null,
      birthdate: null,
      class_role: null,
      seat_locked: false,
    })
  }
  return { seats, highlight: mine ? [child.enrollment_id] : [] }
}
