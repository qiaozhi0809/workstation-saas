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
