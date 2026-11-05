import { buildRows, filterRows, sortRows } from './rosterView'
import { rec } from './fixtures'

const TODAY = '2026-11-02'
const none = new Map<string, { rank: number | null; change: number | null }>()

const records = [
  rec({
    enrollment_id: 'e1',
    name: '张三',
    student_no: '1',
    gender: '男',
    class_role: '班长',
    tags: ['重点关注'],
    birthdate: '2015-11-20',
  }),
  rec({
    enrollment_id: 'e2',
    name: '李四',
    student_no: '10',
    gender: '女',
    boarding: true,
    seat_row: null,
    seat_col: null,
    birthdate: '2015-03-01',
  }),
  rec({
    enrollment_id: 'e3',
    name: '王五',
    student_no: '2',
    gender: '男',
    tags: ['住校', 'Math'],
    birthdate: null,
  }),
  rec({
    enrollment_id: 'e4',
    name: '赵六',
    student_no: null,
    gender: '女',
    birthdate: '2015-11-02',
  }),
]
const rows = buildRows(records, none, null, TODAY)
const names = (r: { name: string }[]) => r.map((x) => x.name)

it('builds rows with rank, points and days to birthday', () => {
  const ranks = new Map([['e1', { rank: 2, change: 3 }]])
  const built = buildRows(records, ranks, new Map([['e1', 5]]), TODAY)
  expect(built[0]).toMatchObject({ rank: 2, rankChange: 3, points: 5, daysToBirthday: 18 })
  expect(built[1]).toMatchObject({ rank: null, rankChange: null, points: 0 })
  expect(built[2].daysToBirthday).toBeNull()
  expect(built[3].daysToBirthday).toBe(0)
  expect(rows[0].points).toBeNull()
})

it('filters by search, cadre, focus, boarding, birthday month and unseated', () => {
  expect(names(filterRows(rows, '李', 'all', TODAY))).toEqual(['李四'])
  expect(names(filterRows(rows, '10', 'all', TODAY))).toEqual(['李四'])
  expect(names(filterRows(rows, 'math', 'all', TODAY))).toEqual(['王五'])
  expect(names(filterRows(rows, '重点', 'all', TODAY))).toEqual(['张三'])
  expect(names(filterRows(rows, '', 'male', TODAY))).toEqual(['张三', '王五'])
  expect(names(filterRows(rows, '', 'female', TODAY))).toEqual(['李四', '赵六'])
  expect(names(filterRows(rows, '', 'cadre', TODAY))).toEqual(['张三'])
  expect(names(filterRows(rows, '', 'focus', TODAY))).toEqual(['张三'])
  expect(names(filterRows(rows, '', 'boarding', TODAY))).toEqual(['李四', '王五'])
  expect(names(filterRows(rows, '', 'birthday', TODAY))).toEqual(['张三', '赵六'])
  expect(names(filterRows(rows, '', 'unseated', TODAY))).toEqual(['李四'])
  expect(filterRows(rows, '  ', 'all', TODAY)).toHaveLength(4)
})

it('sorts student numbers naturally with blanks last and reverses on demand', () => {
  expect(names(sortRows(rows, 'no', 'asc'))).toEqual(['张三', '王五', '李四', '赵六'])
  expect(names(sortRows(rows, 'no', 'desc'))).toEqual(['李四', '王五', '张三', '赵六'])
})

it('keeps blank student numbers last and ordered by name ascending in both directions', () => {
  const list = buildRows(
    [
      rec({ enrollment_id: 'b1', name: '王五', student_no: null }),
      rec({ enrollment_id: 'b2', name: '李四', student_no: '' }),
      rec({ enrollment_id: 'b3', name: '赵六', student_no: '3' }),
      rec({ enrollment_id: 'b4', name: '张三', student_no: '1' }),
    ],
    none,
    null,
    TODAY,
  )
  expect(names(sortRows(list, 'no', 'asc'))).toEqual(['张三', '赵六', '李四', '王五'])
  expect(names(sortRows(list, 'no', 'desc'))).toEqual(['赵六', '张三', '李四', '王五'])
})

it('sorts by rank and birthday with blanks last', () => {
  const built = buildRows(
    records,
    new Map([
      ['e1', { rank: 2, change: null }],
      ['e2', { rank: 1, change: null }],
    ]),
    null,
    TODAY,
  )
  expect(names(sortRows(built, 'rank', 'asc'))).toEqual(['李四', '张三', '王五', '赵六'])
  expect(names(sortRows(built, 'rank', 'desc'))).toEqual(['张三', '李四', '王五', '赵六'])
  expect(names(sortRows(built, 'birthday', 'asc'))).toEqual(['赵六', '张三', '李四', '王五'])
})

it('sorts by points descending by default', () => {
  const built = buildRows(
    records,
    none,
    new Map([
      ['e1', 3],
      ['e2', 9],
      ['e3', 3],
    ]),
    TODAY,
  )
  expect(names(sortRows(built, 'points', 'desc'))).toEqual(['李四', '张三', '王五', '赵六'])
  expect(names(sortRows(built, 'points', 'asc'))).toEqual(['赵六', '张三', '王五', '李四'])
})

it('sorts by name', () => {
  expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['李四', '王五', '张三', '赵六'])
  expect(names(sortRows(rows, 'name', 'desc'))).toEqual(['赵六', '张三', '王五', '李四'])
})
