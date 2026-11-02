import { attendanceMonthRows } from './exportMonth'
import { nextStatus } from './cycle'

it('cycles present → leave → absent → late → present', () => {
  expect(['present', 'leave', 'absent', 'late'].map((s) => nextStatus(s as never))).toEqual([
    'leave', 'absent', 'late', 'present',
  ])
})

it('builds a monthly sheet with one column per day and totals', () => {
  const roster = [
    { enrollment_id: 'e2', name: '李小二', student_no: '2026010' },
    { enrollment_id: 'e1', name: '王小一', student_no: '2026002' },
  ]
  const rows = attendanceMonthRows('2027-02', roster, [
    { enrollment_id: 'e1', date: '2027-02-01', status: 'leave' },
    { enrollment_id: 'e1', date: '2027-02-03', status: 'late' },
  ])
  expect(rows[0]).toHaveLength(2 + 28 + 3)
  expect(rows[0].slice(0, 3)).toEqual(['学号', '姓名', '01'])
  expect(rows[1].slice(0, 5)).toEqual(['2026002', '王小一', '请假', '', '迟到'])
  expect(rows[1].slice(-3)).toEqual([1, 0, 1])
  expect(rows[2][1]).toBe('李小二')
})

it('orders the monthly sheet by the shared roster order (numeric, empty student no last)', () => {
  const roster = [
    { enrollment_id: 'a', name: '甲', student_no: null },
    { enrollment_id: 'b', name: '乙', student_no: '10' },
    { enrollment_id: 'c', name: '丙', student_no: '2' },
  ]
  const rows = attendanceMonthRows('2027-02', roster, [])
  expect(rows.slice(1).map((r) => r[0])).toEqual(['2', '10', ''])
})
