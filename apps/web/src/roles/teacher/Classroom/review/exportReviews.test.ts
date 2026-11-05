import type { Review } from '@/shared/types/review'
import { reviewRows } from './exportReviews'

it('exports reviews with local time and numeric scores', () => {
  const item: Review = {
    id: 'r1',
    op_id: 'o1',
    enrollment_id: 'e1',
    category: 'individual',
    reason_text: '积极发言',
    score_delta: -1,
    subject: '数学',
    given_at: '2026-11-01T16:30:00Z',
    given_by_me: true,
    student_name: '王小一',
    transferred: false,
  }
  const rows = reviewRows(
    [item],
    [{ enrollment_id: 'e1', name: '王小一', student_no: '2026001' }],
    'Asia/Shanghai',
  )
  expect(rows).toEqual([
    ['时间', '姓名', '学号', '分值', '理由', '科目'],
    ['2026-11-02 00:30', '王小一', '2026001', -1, '积极发言', '数学'],
  ])
})

const base: Review = {
  id: 'r2',
  op_id: 'o2',
  enrollment_id: 'gone',
  category: 'individual',
  reason_text: '作业优秀',
  score_delta: 2,
  subject: null,
  given_at: '2026-11-01T16:30:00Z',
  given_by_me: true,
  student_name: '赵小四',
  transferred: false,
}

it('names transferred students with a suffix and leaves the student number empty', () => {
  const rows = reviewRows([{ ...base, transferred: true }], [], 'Asia/Shanghai')
  expect(rows[1].slice(1, 3)).toEqual(['赵小四（已转出）', ''])
})

it('falls back to the returned name when a student is not in the roster', () => {
  const rows = reviewRows([base], [], 'Asia/Shanghai')
  expect(rows[1].slice(1, 3)).toEqual(['赵小四', ''])
})
