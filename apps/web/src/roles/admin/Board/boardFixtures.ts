import type { BoardClass, BoardView } from '@/shared/types/admin'
import type { StudentSeat } from '@/shared/types/student'

/** 测试夹具:只用虚构姓名 */
export const seat = (n: number, name: string, col: number): StudentSeat => ({
  enrollment_id: `e${n}`,
  student_id: `s${n}`,
  name,
  mk: `S000${n}`,
  seat_row: 1,
  seat_col: col,
  avatar_seed: null,
  gender: n % 2 ? '男' : '女',
  student_no: `202600${n}`,
  birthdate: null,
  class_role: null,
  seat_locked: false,
})

export const boardClass = (over: Partial<BoardClass> = {}): BoardClass => ({
  id: 'c1',
  name: '三年一班',
  room: '301',
  cameras: 0,
  homeroom_name: '赵老师',
  seat_rows: 3,
  seat_cols: 4,
  desk_size: 2,
  podium_left: 0,
  podium_right: 0,
  seats: [seat(1, '王小一', 1), seat(2, '李小二', 2), seat(3, '张小三', 3)],
  attendance: { e2: 'absent', e3: 'late' },
  metrics: { students: 3, present: 2, leave: 0, absent: 1, late: 1, confirmed: true, week_net: 5 },
  ...over,
})

export const boardView = (over: Partial<BoardView> = {}): BoardView => ({
  grades: [
    { id: 'g3', name: '三年级', effective_stage: 'primary' },
    { id: 'g4', name: '四年级', effective_stage: 'primary' },
  ],
  grade_id: 'g3',
  classes: [
    boardClass(),
    boardClass({
      id: 'c2',
      name: '三年二班',
      room: '302',
      homeroom_name: null,
      seats: [seat(4, '钱小四', 1)],
      attendance: {},
      metrics: {
        students: 1,
        present: 1,
        leave: 0,
        absent: 0,
        late: 0,
        confirmed: false,
        week_net: -2,
      },
    }),
  ],
  ...over,
})
