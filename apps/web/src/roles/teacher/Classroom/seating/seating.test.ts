import type { DeskGrid } from '@/shared/lib/seats'
import { genderPairSeats, mentorSeats, shuffleSeats } from './algorithms'
import {
  draftReducer,
  initDraft,
  isDirty,
  occupantAt,
  toSavePayload,
  type DraftStudent,
} from './draft'

const lcg =
  (seed = 1) =>
  () =>
    ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const st = (
  id: string,
  gender: DraftStudent['gender'],
  row: number | null,
  col: number | null,
  locked = false,
): DraftStudent => ({ enrollmentId: id, name: id, studentNo: null, gender, row, col, locked })
const grid = (
  rows: number,
  cols: number,
  deskSize: DeskGrid['deskSize'] = 2,
  podiumLeft = 0,
  podiumRight = 0,
): DeskGrid => ({ rows, cols, deskSize, podiumLeft, podiumRight })
const g3 = grid(2, 6, 3, 1, 0)

describe('draft', () => {
  const base = () =>
    initDraft({
      grid: grid(2, 2),
      baseVersion: 3,
      students: [
        st('a', 'male', 1, 1),
        st('b', 'female', 1, 2),
        st('c', 'male', null, null),
        st('d', null, 2, 1, true),
      ],
    })

  it('swaps two seated students and undoes', () => {
    const s1 = draftReducer(base(), { type: 'moveTo', enrollmentId: 'a', to: { row: 1, col: 2 } })
    expect(occupantAt(s1, { row: 1, col: 2 })?.enrollmentId).toBe('a')
    expect(occupantAt(s1, { row: 1, col: 1 })?.enrollmentId).toBe('b')
    expect(isDirty(s1, base())).toBe(true)
    expect(isDirty(draftReducer(s1, { type: 'undo' }), base())).toBe(false)
  })

  it('sends the occupant to the tray when a tray student takes the seat', () => {
    const s1 = draftReducer(base(), { type: 'moveTo', enrollmentId: 'c', to: { row: 1, col: 1 } })
    expect(s1.students.find((x) => x.enrollmentId === 'a')).toMatchObject({ row: null, col: null })
  })

  it('never moves a locked student', () => {
    const s1 = draftReducer(base(), {
      type: 'swapCells',
      from: { row: 1, col: 1 },
      to: { row: 2, col: 1 },
    })
    expect(occupantAt(s1, { row: 2, col: 1 })?.enrollmentId).toBe('d')
    expect(s1.past).toHaveLength(0)
  })

  it('serialises only seated students', () => {
    expect(toSavePayload(base())).toEqual({
      base_version: 3,
      rows: 2,
      cols: 2,
      seats: [
        { enrollment_id: 'a', row: 1, col: 1, locked: false },
        { enrollment_id: 'b', row: 1, col: 2, locked: false },
        { enrollment_id: 'd', row: 2, col: 1, locked: true },
      ],
    })
  })

  it('caps undo history at 30 and clears the selection on change', () => {
    let s = draftReducer(base(), { type: 'select', enrollmentId: 'a' })
    expect(s.selected).toBe('a')
    expect(s.past).toHaveLength(0)
    for (let i = 0; i < 35; i++) {
      s = draftReducer(s, {
        type: 'moveTo',
        enrollmentId: 'a',
        to: i % 2 === 0 ? { row: 2, col: 2 } : { row: 1, col: 1 },
      })
    }
    expect(s.past).toHaveLength(30)
    expect(s.selected).toBeNull()
  })

  it('treats no-op actions as unchanged without pushing history', () => {
    const b = base()
    expect(
      draftReducer(b, { type: 'moveTo', enrollmentId: 'a', to: { row: 1, col: 1 } }).past,
    ).toHaveLength(0)
    expect(draftReducer(b, { type: 'unseat', enrollmentId: 'd' }).past).toHaveLength(0)
    expect(draftReducer(b, { type: 'unseat', enrollmentId: 'c' }).past).toHaveLength(0)
    expect(draftReducer(b, { type: 'toggleLock', enrollmentId: 'c' }).past).toHaveLength(0)
    expect(
      draftReducer(b, { type: 'swapCells', from: { row: 2, col: 2 }, to: { row: 1, col: 1 } }).past,
    ).toHaveLength(0)
    expect(draftReducer(b, { type: 'undo' })).toBe(b)
  })

  it('unseats and toggles lock on seated students', () => {
    const s1 = draftReducer(base(), { type: 'unseat', enrollmentId: 'a' })
    expect(s1.students.find((x) => x.enrollmentId === 'a')).toMatchObject({ row: null, col: null })
    const s2 = draftReducer(base(), { type: 'toggleLock', enrollmentId: 'a' })
    expect(s2.students.find((x) => x.enrollmentId === 'a')?.locked).toBe(true)
  })
})

describe('algorithms', () => {
  it('shuffle keeps locked students in place and overflows to the tray', () => {
    const students = [
      st('l', null, 1, 1, true),
      ...['a', 'b', 'c', 'd'].map((id) => st(id, null, null, null)),
    ]
    const out = shuffleSeats(students, grid(2, 2), lcg())
    expect(out.find((x) => x.enrollmentId === 'l')).toMatchObject({ row: 1, col: 1 })
    expect(out.filter((x) => x.row === null)).toHaveLength(1)
  })

  it('pairs a boy with a girl at every desk when numbers match', () => {
    const students = [
      ...['m1', 'm2', 'm3', 'm4'].map((id) => st(id, 'male', null, null)),
      ...['f1', 'f2', 'f3', 'f4'].map((id) => st(id, 'female', null, null)),
    ]
    const out = genderPairSeats(students, grid(2, 4), lcg(7))
    for (const row of [1, 2])
      for (const left of [1, 3]) {
        const pair = out.filter((x) => x.row === row && (x.col === left || x.col === left + 1))
        expect(new Set(pair.map((x) => x.gender))).toEqual(new Set(['male', 'female']))
      }
  })

  it('uses single desks for odd column counts and still seats unknown genders', () => {
    const students = [
      st('m', 'male', null, null),
      st('f', 'female', null, null),
      st('u', null, null, null),
    ]
    const out = genderPairSeats(students, grid(1, 3), lcg(3))
    expect(out.every((x) => x.row === 1)).toBe(true)
    const pair = out.filter((x) => x.col === 1 || x.col === 2).map((x) => x.gender)
    expect(new Set(pair)).toEqual(new Set(['male', 'female']))
  })

  it('returns inputs in order without mutating them', () => {
    const students = [st('a', null, null, null), st('b', null, null, null)]
    const out = shuffleSeats(students, grid(1, 2), lcg())
    expect(out.map((x) => x.enrollmentId)).toEqual(['a', 'b'])
    expect(students.every((x) => x.row === null)).toBe(true)
  })
})

describe('podium seats and k-seat desks', () => {
  const at = (out: DraftStudent[], id: string) => out.find((x) => x.enrollmentId === id)!
  const six = () => ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => st(id, null, null, null))

  it('never moves a podium student when shuffling', () => {
    // 讲台左边 1 个 + 2 排 x 6 列:5 人上普通座位,一人在 (0,-1)
    const students = [
      st('p', null, 0, -1),
      ...['a', 'b', 'c', 'd', 'e'].map((id) => st(id, null, null, null)),
    ]
    for (const seed of [1, 2, 3]) {
      const out = shuffleSeats(students, g3, lcg(seed))
      expect(at(out, 'p')).toMatchObject({ row: 0, col: -1 })
      const others = out.filter((x) => x.enrollmentId !== 'p')
      expect(others.every((x) => x.row !== null && x.row >= 1)).toBe(true)
      expect(new Set(out.map((x) => `${x.row},${x.col}`)).size).toBe(6)
    }
  })

  it('keeps podium students fixed in the pair and mentor algorithms too', () => {
    const students = [
      st('p', 'male', 0, -1),
      ...['a', 'b', 'c', 'd'].map((id, i) => st(id, i % 2 ? 'male' : 'female', null, null)),
    ]
    expect(at(genderPairSeats(students, g3, lcg()), 'p')).toMatchObject({ row: 0, col: -1 })
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ])
    const out = mentorSeats(students, g3, ranks, lcg())
    expect(at(out, 'p')).toMatchObject({ row: 0, col: -1 })
    expect(out.every((x) => x.row !== null)).toBe(true)
  })

  it('seats top, middle and bottom at each triple desk for mentor', () => {
    const ranks = new Map(six().map((s, i) => [s.enrollmentId, i + 1]))
    const out = mentorSeats(six(), grid(2, 3, 3), ranks, lcg(4))
    const rankSet = (row: number) =>
      out
        .filter((x) => x.row === row)
        .map((x) => ranks.get(x.enrollmentId)!)
        .sort((a, b) => a - b)
    expect([rankSet(1), rankSet(2)].sort((x, y) => x[0] - y[0])).toEqual([
      [1, 4, 6],
      [2, 3, 5],
    ])
    expect(out).toHaveLength(6)
    expect(new Set(out.map((x) => `${x.row},${x.col}`)).size).toBe(6)
    // 名次居中的那位坐在三个座位的正中
    for (const row of [1, 2]) {
      const mid = out.find((x) => x.row === row && x.col === 2)!
      const set = rankSet(row)
      expect(ranks.get(mid.enrollmentId)).toBe(set[1])
    }
  })

  it('alternates genders across a triple desk', () => {
    const students = [
      ...['m1', 'm2', 'm3'].map((id) => st(id, 'male', null, null)),
      ...['f1', 'f2', 'f3'].map((id) => st(id, 'female', null, null)),
    ]
    for (const seed of [1, 5, 9]) {
      const out = genderPairSeats(students, grid(2, 3, 3), lcg(seed))
      for (const row of [1, 2]) {
        const seq = [1, 2, 3]
          .map((col) => out.find((x) => x.row === row && x.col === col)!.gender)
          .join()
        expect(['male,female,male', 'female,male,female']).toContain(seq)
      }
      expect(new Set(out.map((x) => `${x.row},${x.col}`)).size).toBe(6)
      expect(new Set(out.map((x) => x.enrollmentId)).size).toBe(6)
    }
  })

  it('moves a student onto and off a podium seat', () => {
    const base = initDraft({
      grid: g3,
      baseVersion: 1,
      students: [st('a', null, 1, 1), st('b', null, null, null)],
    })
    const on = draftReducer(base, { type: 'moveTo', enrollmentId: 'a', to: { row: 0, col: -1 } })
    expect(occupantAt(on, { row: 0, col: -1 })?.enrollmentId).toBe('a')
    const off = draftReducer(on, { type: 'moveTo', enrollmentId: 'a', to: { row: 1, col: 1 } })
    expect(occupantAt(off, { row: 1, col: 1 })?.enrollmentId).toBe('a')
    // 右边没有桌:不变
    expect(draftReducer(base, { type: 'moveTo', enrollmentId: 'a', to: { row: 0, col: 1 } })).toBe(
      base,
    )
    // 第二个讲台座位(外侧)左边只有 1 张桌:也不存在
    expect(draftReducer(base, { type: 'moveTo', enrollmentId: 'a', to: { row: 0, col: -2 } })).toBe(
      base,
    )
  })

  it('keeps pair behaviour for double desks', () => {
    const students = [
      ...['m1', 'm2'].map((id) => st(id, 'male', null, null)),
      ...['f1', 'f2'].map((id) => st(id, 'female', null, null)),
    ]
    const out = genderPairSeats(students, grid(1, 4), lcg(2))
    for (const left of [1, 3]) {
      const pair = out.filter((x) => x.col === left || x.col === left + 1)
      expect(new Set(pair.map((x) => x.gender))).toEqual(new Set(['male', 'female']))
    }
  })

  it('pairs genders without losing anyone when counts are unbalanced (4 boys, 2 girls, k=3)', () => {
    const students = [
      ...['m1', 'm2', 'm3', 'm4'].map((id) => st(id, 'male', null, null)),
      ...['f1', 'f2'].map((id) => st(id, 'female', null, null)),
    ]
    for (const seed of [1, 5, 9]) {
      const out = genderPairSeats(students, grid(2, 3, 3), lcg(seed))
      expect(out).toHaveLength(6)
      expect(out.every((x) => x.row !== null && x.col !== null)).toBe(true)
      expect(new Set(out.map((x) => `${x.row},${x.col}`)).size).toBe(6)
      expect(new Set(out.map((x) => x.enrollmentId)).size).toBe(6)
    }
  })

  it('saves podium seats first with current grid dims', () => {
    const d = initDraft({
      grid: g3,
      baseVersion: 2,
      students: [st('a', null, 1, 1), st('p', null, 0, -1)],
    })
    const payload = toSavePayload(d)
    expect(payload.seats[0]).toMatchObject({ enrollment_id: 'p', row: 0, col: -1 })
    expect(payload).toMatchObject({ rows: 2, cols: 6, base_version: 2 })
  })

  it('keeps the draft studentNo field and ignores layout when comparing dirtiness', () => {
    const d = initDraft({
      grid: g3,
      baseVersion: 2,
      students: [{ ...st('a', null, 1, 1), studentNo: '2026009' }],
    })
    expect(d.students[0].studentNo).toBe('2026009')
    expect(isDirty(d, d)).toBe(false)
  })
})

describe('mentorSeats', () => {
  const at = (out: DraftStudent[], id: string) => out.find((x) => x.enrollmentId === id)!

  it('pairs the top with the bottom and keeps locked seats', () => {
    const students = [
      st('a', null, null, null),
      st('b', null, null, null),
      st('c', null, null, null),
      st('d', null, null, null),
    ]
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ])
    const out = mentorSeats(students, grid(2, 2), ranks, lcg(5))
    const desk = (id: string) =>
      out
        .filter((x) => x.row === at(out, id).row)
        .map((x) => x.enrollmentId)
        .sort()
    expect(desk('a')).toEqual(['a', 'd'])
    expect(desk('b')).toEqual(['b', 'c'])

    const locked = [st('a', null, 1, 1, true), ...students.slice(1)]
    const out2 = mentorSeats(locked, grid(2, 2), ranks, lcg(5))
    expect(at(out2, 'a')).toMatchObject({ row: 1, col: 1 })
    expect(out2.every((x) => x.row !== null)).toBe(true)
    // a 固定后剩下的一对(b 配 d)仍坐同一张桌:同排、列为 1 和 2
    expect(at(out2, 'b').row).toBe(at(out2, 'd').row)
    expect([at(out2, 'b').col, at(out2, 'd').col].sort()).toEqual([1, 2])
    const cells = new Set(out2.map((x) => `${x.row},${x.col}`))
    expect(cells.size).toBe(4)
  })

  it('places students without a rank after the pairs', () => {
    const students = [
      st('a', null, null, null),
      st('b', null, null, null),
      st('c', null, null, null),
      st('x', null, null, null),
    ]
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    const out = mentorSeats(students, grid(1, 4), ranks, lcg(2))
    // 1 排 4 列 = 2 张桌:a 与 c 同桌;b(中间一人)与无名次的 x 单独
    const pos = (id: string) => at(out, id).col!
    expect(Math.abs(pos('a') - pos('c'))).toBe(1)
    expect(Math.ceil(pos('a') / 2)).toBe(Math.ceil(pos('c') / 2))
    expect(out.every((s) => s.row === 1)).toBe(true)
    expect(new Set(out.map((s) => s.col)).size).toBe(4)
  })

  it('leaves students without a rank unseated last when seats run out', () => {
    const students = [
      st('a', null, null, null),
      st('b', null, null, null),
      st('c', null, null, null),
      st('d', null, null, null),
      st('x', null, null, null),
    ]
    const ranks = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ])
    // 1 排 3 列 = 1 张桌 + 1 个单座:一对上桌,另一对的第一人补单座,x(无名次)最后落空
    const out = mentorSeats(students, grid(1, 3), ranks, lcg(2))
    expect(at(out, 'x')).toMatchObject({ row: null, col: null })
    expect(out.filter((s) => s.row === null)).toHaveLength(2)
  })
})
