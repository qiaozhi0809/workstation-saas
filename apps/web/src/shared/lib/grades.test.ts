import { describe, expect, it } from 'vitest'
import type { GradebookExam, ScoreValue } from '../types/grades'
import {
  attention, cellState, examStats, examTable, latestExam, parseScore, previousExam, rankChanges,
  rankTint, scoreBands, studentTrend, subjectStats, trendDomain,
  type Row,
} from './grades'

const SUBJECTS = ['语文', '数学', '英语']
const IDS = Array.from({ length: 10 }, (_, i) => `e${i}`)

function makeExam(
  id: string, name: string, date: string,
  cols: Record<string, ScoreValue[]>, ids: string[] = IDS,
): GradebookExam {
  const subjects = Object.keys(cols).map((s) => ({ name: s, full: 100 }))
  const scores: Record<string, Record<string, ScoreValue>> = {}
  ids.forEach((eid, i) => {
    scores[eid] = {}
    for (const s of Object.keys(cols)) scores[eid][s] = cols[s][i]
  })
  return {
    id, name, exam_type: '期中', date, subjects, scores,
    created_by_me: true, progress: { entered: ids.length, total: ids.length },
  }
}

const mid = makeExam('mid', '期中', '2026-10-30', {
  语文: [93, 90, 80, 89, 62, 84, 69, 97, 71, 83],
  数学: [95, 88, 85, 70, 55, 90, 60, 98, 78, 82],
  英语: [90, 92, 74, 88, null, 81, 70, 94, 62, 91],
})
const monthly = makeExam('monthly', '月考', '2026-10-09', {
  语文: [95, 88, 76, 92, 58, 81, 70, 99, 64, 85],
  数学: [90, 92, 81, 77, 49, 85, 66, 100, 72, 80],
  英语: [88, 95, 70, 85, 60, 79, 73, 96, 55, 90],
})

const abc = ['a', 'b', 'c']
function exam2(id: string, scores: Record<string, Record<string, ScoreValue>>, subs = ['甲', '乙']): GradebookExam {
  return {
    id, name: id, exam_type: '月考', date: '2026-01-01',
    subjects: subs.map((name) => ({ name, full: 100 })), scores,
    created_by_me: true, progress: { entered: 0, total: 0 },
  }
}
const empty = exam2('empty', {})

describe('parseScore / cellState', () => {
  it('parses full-width digits, absent marks and clears', () => {
    expect(parseScore('９８．５')).toBe(98.5)
    expect(parseScore(' 缺考 ')).toBe('absent')
    expect(parseScore('—')).toBe('absent')
    expect(parseScore('')).toBe('clear')
    expect(parseScore('88.25')).toBe('invalid')
    expect(parseScore('abc')).toBe('invalid')
  })
  it('handles the other absent marks, whitespace and negatives', () => {
    for (const t of ['缺', '-', '/', 'x', 'X']) expect(parseScore(t)).toBe('absent')
    expect(parseScore('   ')).toBe('clear')
    expect(parseScore('９ ０')).toBe(90)
    expect(parseScore('0')).toBe(0)
    expect(parseScore('－５')).toBe(-5)
    expect(parseScore('-5')).toBe(-5)
    expect(parseScore('1.2.3')).toBe('invalid')
  })
  it('classifies cells against the full mark', () => {
    expect(cellState(undefined, 100)).toBe('empty'); expect(cellState(null, 100)).toBe('absent')
    expect(cellState(101, 100)).toBe('over'); expect(cellState(59.5, 100)).toBe('low'); expect(cellState(60, 100)).toBe('ok')
    expect(cellState(-1, 100)).toBe('over')
    expect(cellState(100, 100)).toBe('ok')
    expect(cellState(0, 100)).toBe('low')
  })
})

describe('examTable', () => {
  it('ranks ties together and skips the next rank', () => {
    const ex = exam2('t', { a: { 甲: 90, 乙: 90 }, b: { 甲: 100, 乙: 80 }, c: { 甲: 80, 乙: 90 } })
    const t = examTable(ex, abc)
    expect(t.map((r) => [r.id, r.total, r.rank])).toEqual([['a', 180, 1], ['b', 180, 1], ['c', 170, 3]])
  })
  it('leaves all-absent students unranked and out of the stats', () => {
    const ex = exam2('t', {
      a: { 甲: 90, 乙: 80 }, b: { 甲: null, 乙: null }, c: { 甲: 60, 乙: 70 },
    })
    const t = examTable(ex, abc)
    expect(t.map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(t[2]).toMatchObject({ id: 'b', total: null, rank: null })
    const st = examStats(ex, abc)!
    expect(st.n).toBe(2)
    expect(st.avg).toBe(150)
  })
  it('treats a student with no record as unranked and keeps list order for nulls', () => {
    const ex = exam2('t', { b: { 甲: 50, 乙: 50 } })
    const t = examTable(ex, abc)
    expect(t.map((r) => [r.id, r.total, r.rank])).toEqual([['b', 100, 1], ['a', null, null], ['c', null, null]])
  })
  it('rounds totals to one decimal so float drift cannot split ties', () => {
    const ex = exam2('t', {
      a: { 甲: 0.1, 乙: 0.2, 丙: 0.3 }, b: { 甲: 0.3, 乙: 0.2, 丙: 0.1 }, c: { 甲: 0, 乙: 0, 丙: 0.5 },
    }, ['甲', '乙', '丙'])
    const t = examTable(ex, abc)
    expect(t.map((r) => [r.id, r.total, r.rank])).toEqual([['a', 0.6, 1], ['b', 0.6, 1], ['c', 0.5, 3]])
    const ex2 = exam2('u', { a: { 甲: 80.1, 乙: 80.1 } })
    expect(examTable(ex2, ['a'])[0].total).toBe(160.2)
  })
  it('distinguishes not-entered (undefined) from absent (null)', () => {
    const ex = exam2('t', { a: { 甲: null }, b: { 甲: 70, 乙: 60 } })
    const [a] = examTable(ex, ['a'])
    expect(a.subs['甲']).toBeNull()
    expect(a.subs['乙']).toBeUndefined()
    expect(a.total).toBeNull()
    expect(cellState(a.subs['甲'], 100)).toBe('absent')
    expect(cellState(a.subs['乙'], 100)).toBe('empty')
  })
  it('sums only entered subjects and counts a partly absent student', () => {
    const t = examTable(mid, IDS)
    const s4 = t.find((r) => r.id === 'e4')!
    expect(s4.total).toBe(117)
    expect(s4.rank).toBe(10)
    expect(s4.subs['英语']).toBeNull()
  })
})

describe('subjectStats', () => {
  it('excludes absent students from n and the average', () => {
    const s = subjectStats(mid, '英语', IDS)!
    expect(s.n).toBe(9)
    expect(s.full).toBe(100)
    expect(s.avg).toBeCloseTo(742 / 9, 2)
    expect(s.rate).toBeCloseTo(742 / 9, 2)
    expect(s.max).toBe(94)
    expect(s.min).toBe(62)
    expect(s.passRate).toBe(1)
    expect(s.goodRate).toBeCloseTo(5 / 9, 5) // 90, 92, 88, 94, 91
    expect(s.low).toBe(0)
  })
  it('counts failing students and returns null when nobody has a score', () => {
    const s = subjectStats(mid, '数学', IDS)!
    expect(s.low).toBe(1) // 55
    expect(s.passRate).toBeCloseTo(0.9, 5)
    const ex = exam2('t', { a: { 甲: null } })
    expect(subjectStats(ex, '甲', abc)).toBeNull()
    expect(subjectStats(ex, '乙', abc)).toBeNull()
    expect(subjectStats(ex, '不存在', abc)).toBeNull()
  })
})

describe('examStats', () => {
  it('computes exam stats like the original', () => {
    const st = examStats(mid, IDS)!
    expect(st.full).toBe(300)
    expect(st.n).toBe(10)
    expect(st.avg).toBeCloseTo(236.1, 2)
    expect(st.rate).toBeCloseTo(78.7, 2)
    expect(st.max).toBe(289)
    expect(st.maxIds).toEqual(['e7'])
    expect(st.min).toBe(117)
    expect(st.passRate).toBeCloseTo(0.9, 5) // 总分 >= 180: all but 117
    expect(st.goodRate).toBeCloseTo(0.5, 5) // >= 255: 278 270 255 256 289
    expect(st.sd).toBeCloseTo(47.72, 2)
    expect(st.table).toHaveLength(10)
    expect(st.subjects.map((s) => s.name)).toEqual(SUBJECTS)
  })
  it('lists every top scorer and returns null with no totals', () => {
    const ex = exam2('t', { a: { 甲: 50, 乙: 50 }, b: { 甲: 60, 乙: 40 }, c: { 甲: 10, 乙: 10 } })
    expect(examStats(ex, abc)!.maxIds).toEqual(['a', 'b'])
    expect(examStats(empty, abc)).toBeNull()
  })
})

describe('scoreBands / trendDomain / rankTint', () => {
  it('builds ten bands from the first non-empty one', () => {
    expect(scoreBands([55, 65, 95, 100], 100).map((b) => [b.lo, b.count, b.tone]))
      .toEqual([[50, 1, 'low'], [60, 1, 'mid'], [70, 0, 'mid'], [80, 0, 'mid'], [90, 2, 'good']])
  })
  it('scales bands to the full mark and handles no data', () => {
    const b = scoreBands([0, 300], 300)
    expect(b).toHaveLength(10)
    expect(b[0]).toMatchObject({ lo: 0, hi: 30, count: 1, tone: 'low' })
    expect(b[9]).toMatchObject({ lo: 270, hi: 300, count: 1, tone: 'good' })
    expect(scoreBands([], 100)).toEqual([])
  })
  it('pads and rounds the trend domain to fives within 0–100', () => {
    expect(trendDomain([62, 91])).toEqual([55, 95]); expect(trendDomain([2, 99])).toEqual([0, 100])
  })
  it('tints ranks in fifths', () => { expect([1, 2, 10].map((r) => rankTint(r, 10))).toEqual([1, 1, 5]) })
  it('caps the tint at 5', () => {
    expect(rankTint(3, 10)).toBe(2)
    expect(rankTint(6, 10)).toBe(3)
    expect(rankTint(11, 10)).toBe(5)
  })
})

describe('exam navigation', () => {
  const s1 = exam2('s1', { a: { 甲: 80 } })
  const blank = exam2('blank', { a: { 甲: null } })
  const s2 = exam2('s2', { a: { 甲: 70 } })
  const noRec = exam2('norec', {})
  it('finds the previous exam with scores, skipping empty ones', () => {
    const book = [s1, blank, noRec, s2]
    expect(previousExam(book, 's2')?.id).toBe('s1')
    expect(previousExam(book, 's1')).toBeNull()
    expect(previousExam(book, 'blank')?.id).toBe('s1')
    expect(previousExam(book, 'missing')).toBeNull()
  })
  it('finds the latest exam that has a score', () => {
    expect(latestExam([s1, s2, blank, noRec])?.id).toBe('s2')
    expect(latestExam([blank, noRec])).toBeNull()
    expect(latestExam([])).toBeNull()
  })
})

describe('rankChanges / attention', () => {
  const row = (id: string, rank: number | null, subs: Record<string, ScoreValue | undefined> = {}): Row =>
    ({ id, total: rank === null ? null : 100 - rank, rank, subs })

  it('maps previous rank minus current rank when both ranked', () => {
    const m = rankChanges(
      [row('a', 1), row('b', 2), row('c', null), row('d', 4)],
      [row('a', 3), row('b', 1), row('c', 2)],
    )
    expect(m.get('a')).toBe(2)
    expect(m.get('b')).toBe(-1)
    expect(m.has('c')).toBe(false)
    expect(m.has('d')).toBe(false)
    expect(rankChanges([row('a', 1)], null).size).toBe(0)
  })

  it('lists risers, fallers of five or more and students failing two subjects', () => {
    const ex = exam2('t', {}, ['甲', '乙', '丙'])
    const ids = Array.from({ length: 20 }, (_, i) => `s${i}`)
    // s0..s6: risers 7..1; s7: -4 (not a faller); s8..s16: fallers -5..-13
    const changes = new Map<string, number>()
    for (let i = 0; i < 7; i++) changes.set(`s${i}`, 7 - i)
    changes.set('s7', -4)
    for (let i = 8; i < 17; i++) changes.set(`s${i}`, -(i - 3))
    changes.set('s17', 0)
    const cur = ids.map((id, i) => row(id, i + 1, { 甲: 90, 乙: 90, 丙: 90 }))
    // failing: s0 fails 3 subjects, s1 2, s2 only 1, s3 absent in two (not failing), s4 fails 2 with a not-entered
    cur[0].subs = { 甲: 10, 乙: 20, 丙: 30 }
    cur[1].subs = { 甲: 59.9, 乙: 40, 丙: 90 }
    cur[2].subs = { 甲: 10, 乙: 60, 丙: 90 }
    cur[3].subs = { 甲: null, 乙: null, 丙: 10 }
    cur[4].subs = { 甲: 0, 乙: 0 }
    for (let i = 10; i < 20; i++) cur[i].subs = { 甲: 0, 乙: 0, 丙: 90 }
    const a = attention(ex, cur, changes)
    expect(a.risers.map((r) => r.id)).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(a.risers.map((r) => r.change)).toEqual([7, 6, 5, 4, 3])
    expect(a.fallers).toHaveLength(6)
    expect(a.fallers.map((r) => r.change)).toEqual([-13, -12, -11, -10, -9, -8])
    expect(a.fallers.every((f) => f.change <= -5)).toBe(true)
    expect(a.failing).toHaveLength(8)
    expect(a.failing[0]).toEqual({ id: 's0', count: 3 })
    expect(a.failing.map((f) => f.count)).toEqual([3, 2, 2, 2, 2, 2, 2, 2])
    expect(a.failing.map((f) => f.id)).not.toContain('s2')
    expect(a.failing.map((f) => f.id)).not.toContain('s3')
  })

  it('uses the exam full marks and keeps -4 out of fallers', () => {
    const ex: GradebookExam = { ...exam2('t', {}, ['甲', '乙']), subjects: [{ name: '甲', full: 50 }, { name: '乙', full: 150 }] }
    const cur = [row('a', 1, { 甲: 29, 乙: 89 }), row('b', 2, { 甲: 30, 乙: 90 })]
    const a = attention(ex, cur, new Map([['a', -4], ['b', -5]]))
    expect(a.failing).toEqual([{ id: 'a', count: 2 }])
    expect(a.fallers).toEqual([{ id: 'b', change: -5 }])
    expect(a.risers).toEqual([])
  })
})

describe('studentTrend', () => {
  it('computes rate as total over full times 100 per exam, in book order', () => {
    const pts = studentTrend([monthly, mid], 'e7', IDS)
    expect(pts.map((p) => p.examId)).toEqual(['monthly', 'mid'])
    expect(pts[0]).toMatchObject({ name: '月考', total: 295, rank: 1, n: 10 })
    expect(pts[0].rate).toBeCloseTo(295 / 3, 5)
    expect(pts[1]).toMatchObject({ name: '期中', total: 289, rank: 1, n: 10 })
    expect(pts[1].rate).toBeCloseTo(289 / 3, 5)
  })
  it('gives null total, rank and rate when the student has no score', () => {
    const ex = exam2('t', { a: { 甲: 50, 乙: 50 }, b: { 甲: null, 乙: null } })
    const pts = studentTrend([ex, empty], 'b', abc)
    expect(pts[0]).toEqual({ examId: 't', name: 't', total: null, rank: null, n: 1, rate: null })
    expect(pts[1].n).toBe(0)
    expect(pts[1].rate).toBeNull()
  })
})
