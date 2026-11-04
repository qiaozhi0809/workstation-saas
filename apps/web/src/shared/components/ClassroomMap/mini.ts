import type { MiniSeatMap } from '@/shared/types/parent'
import type { StudentSeat } from '@/shared/types/student'

// 家长端迷你教室:后端只给坐标,这里补成 ClassroomMap 吃的座位;别人的座位匿名,孩子的座位带姓名并高亮
export function seatsFromMiniMap(
  map: MiniSeatMap,
  child: { enrollment_id: string; name: string; gender: string | null },
): { seats: StudentSeat[]; highlight: string[] } {
  const { mine } = map
  const seats = map.occupied.map(({ row, col }): StudentSeat => {
    const isMine = !!mine && mine.row === row && mine.col === col
    return {
      enrollment_id: isMine ? child.enrollment_id : `seat:${row}:${col}`,
      student_id: '', name: isMine ? child.name : '', mk: '',
      seat_row: row, seat_col: col, avatar_seed: null,
      gender: isMine ? child.gender : null, student_no: null, birthdate: null, class_role: null, seat_locked: false,
    }
  })
  return { seats, highlight: mine ? [child.enrollment_id] : [] }
}
