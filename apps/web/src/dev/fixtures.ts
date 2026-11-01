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
