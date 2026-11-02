import { toCSV } from '@/shared/lib/csv'
import type { StudentRecord } from '@/shared/types/student'

export const ROSTER_HEADER = [
  '学号', '姓名', '性别', '生日', '职务', '座位', '家长姓名', '关系', '家长电话',
  '家庭结构', '家庭备注', '学习情况', '性格特长', '健康情况', '标签', '积分',
]

/** 16 列名单 CSV;联系人取第一组;points 以 enrollment_id 为键,null = 无积分权限(留空)。 */
export function rosterCsv(rows: StudentRecord[], points: Map<string, number> | null): string {
  return toCSV([
    ROSTER_HEADER,
    ...rows.map((r) => {
      const c = r.contacts?.[0]
      return [
        r.student_no, r.name, r.gender, r.birthdate, r.class_role,
        r.seat_row !== null && r.seat_col !== null ? `${r.seat_row}-${r.seat_col}` : '',
        c?.name, c?.relation, c?.phone,
        r.family_structure, r.family_note, r.learning_summary, r.personality, r.health_notes,
        (r.tags ?? []).join('、'),
        points ? points.get(r.enrollment_id) ?? 0 : '',
      ]
    }),
  ])
}
