import type { StudentRecord } from '@/shared/types/student'

/** 测试用学生记录(虚构姓名与电话) */
export function rec(over: Partial<StudentRecord> = {}): StudentRecord {
  const id = over.enrollment_id ?? 'e1'
  return {
    enrollment_id: id,
    student_id: `s-${id}`,
    name: '张三',
    mk: 'S0001',
    seat_row: 1,
    seat_col: 1,
    avatar_seed: null,
    gender: '男',
    student_no: '1',
    birthdate: '2015-03-09',
    class_role: null,
    seat_locked: false,
    ...over,
  }
}
