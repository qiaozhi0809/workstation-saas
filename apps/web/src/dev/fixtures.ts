import type { BoardData, SeatView } from '@/shared/components/ClassroomMap/types'
import type { StudentSeat } from '@/shared/types/student'

const NAMES = [
  '林小满', '陈知夏', '王子墨', '李若曦', '张亦辰', '周安然', '吴思齐', '郑佳宁', '孙牧野', '赵清和',
  '钱予安', '冯一诺', '陆星河', '沈听雨', '韩景行', '唐晓棠', '杨慕白', '何知意', '许嘉树', '曹念安',
]
const ROLES = ['班长', '学习委员', '劳动委员', null, null]

export function makeSeats(rows: number, cols: number, filled: number): StudentSeat[] {
  const n = Math.max(0, Math.min(filled, rows * cols))
  return Array.from({ length: n }, (_, i) => {
    const id = String(i + 1).padStart(2, '0')
    return {
      enrollment_id: `e${id}`, student_id: `s${id}`, name: NAMES[i % NAMES.length], mk: `S${id.padStart(4, '0')}`,
      seat_row: Math.floor(i / cols) + 1, seat_col: (i % cols) + 1, avatar_seed: `seed-${id}`,
      gender: i % 2 === 0 ? '女' : '男', student_no: `2026${id.padStart(4, '0')}`,
      birthdate: `2014-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      class_role: ROLES[i % ROLES.length], seat_locked: i % 7 === 6,
    }
  })
}

export const SAMPLE_BOARD: BoardData = {
  leftTitle: '今日课程', leftLines: ['1 语文', '2 数学', '3 英语', '4 科学', '5 音乐'],
  rightTitle: '今日事项', rightLines: ['交春游回执', '值日:第三组'],
  screenTitle: '三年二班 · 11月2日 星期一',
  countdown: { label: '期末考试', days: 74 },
  stars: [{ name: '王小一', points: 5 }, { name: '李安然', points: 4 }], birthdays: [],
}

// 给前几个学生套上各种外观,检查 ghost / chip / badge / locked / selected
export function sampleViews(seats: StudentSeat[]): Record<string, SeatView> {
  const v: SeatView[] = [
    { ghost: true },
    { chip: { text: '请假', tone: 'amber' } },
    { badge: { text: '+3', tone: 'green' } },
    { badge: { text: '-1', tone: 'coral', strong: true }, chip: { text: '迟到', tone: 'red' } },
    { locked: true, chip: { text: '值日', tone: 'blue' } },
    { selected: true },
  ]
  return Object.fromEntries(seats.slice(0, v.length).map((s, i) => [s.enrollment_id, v[i]]))
}
