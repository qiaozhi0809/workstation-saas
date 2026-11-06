import type { GradebookExam, ScoreValue } from '../types/grades'
import type { Grading } from '../types/school'

/** 学校没配置时的及格 / 优秀比例;只给测试与加载中占位用,页面一律传 useGrading() 的值 */
export const DEFAULT_GRADING: Grading = { pass_ratio: 0.6, good_ratio: 0.85 }

export type Parsed = number | 'absent' | 'clear' | 'invalid'

export function parseScore(text: string): Parsed {
  const s = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/－/g, '-')
    .replace(/\s+/g, '')
  if (s === '') return 'clear'
  if (/^(缺|缺考|-|—|\/|x|X)$/.test(s)) return 'absent'
  if (!/^-?\d+(\.\d)?$/.test(s)) return 'invalid'
  return Number(s)
}

/**
 * 及格 / 优秀线 = 满分 × 比例,保留两位小数;与后端 app/ai/stats.py::score_line 同规则。
 * 满分是整数、比例两位小数,乘积在数学上最多两位小数;取整只是抹掉浮点误差
 * (100 × 0.55 = 55.00000000000001,不取整时 55 分会被判不及格)。所有"是否过线"的比较都走它。
 */
export function scoreLine(full: number, ratio: number): number {
  return Math.round(full * ratio * 100) / 100
}

export type CellState = 'empty' | 'absent' | 'over' | 'low' | 'ok'

/** ratios:学校的及格 / 优秀比例(useGrading());低于及格线(scoreLine)为 low */
export function cellState(v: ScoreValue | undefined, full: number, ratios: Grading): CellState {
  if (v === undefined) return 'empty'
  if (v === null) return 'absent'
  if (v < 0 || v > full) return 'over'
  if (v < scoreLine(full, ratios.pass_ratio)) return 'low'
  return 'ok'
}

/** id 均为 enrollment_id */
export interface Row {
  id: string
  total: number | null
  rank: number | null
  subs: Record<string, ScoreValue | undefined>
}

function examFull(exam: GradebookExam): number {
  return exam.subjects.reduce((sum, s) => sum + s.full, 0)
}

/** ids:enrollment_id 列表 */
export function examTable(exam: GradebookExam, ids: string[]): Row[] {
  const rows: Row[] = ids.map((id) => {
    const rec = exam.scores[id]
    const subs: Record<string, ScoreValue | undefined> = {}
    let total: number | null = null
    for (const { name } of exam.subjects) {
      const v = rec?.[name]
      subs[name] = v
      if (typeof v === 'number') total = (total ?? 0) + v
    }
    return { id, total: total === null ? null : Math.round(total * 10) / 10, rank: null, subs }
  })
  rows.sort((a, b) => {
    if (a.total === null && b.total === null) return 0
    if (a.total === null) return 1
    if (b.total === null) return -1
    return b.total - a.total
  })
  let prev: number | null = null
  let prevRank = 0
  rows.forEach((r, i) => {
    if (r.total === null) return
    if (r.total !== prev) {
      prevRank = i + 1
      prev = r.total
    }
    r.rank = prevRank
  })
  return rows
}

export interface SubjectStats {
  name: string
  full: number
  n: number
  avg: number
  /** 得分率,百分数 0-100(avg / full x 100) */
  rate: number
  max: number
  min: number
  /** 及格率,小数 0-1 */
  passRate: number
  /** 优秀率,小数 0-1 */
  goodRate: number
  /** 低分人数:低于及格线(满分 × 及格比例)的学生数(计数,不是比例) */
  low: number
}

/** ids:enrollment_id 列表;ratios:学校的及格 / 优秀比例 */
export function subjectStats(
  exam: GradebookExam,
  subject: string,
  ids: string[],
  ratios: Grading,
): SubjectStats | null {
  const sub = exam.subjects.find((s) => s.name === subject)
  if (!sub) return null
  const vals: number[] = []
  for (const id of ids) {
    const v = exam.scores[id]?.[subject]
    if (typeof v === 'number') vals.push(v)
  }
  const n = vals.length
  if (n === 0) return null
  const avg = vals.reduce((a, b) => a + b, 0) / n
  const pass = scoreLine(sub.full, ratios.pass_ratio)
  const good = scoreLine(sub.full, ratios.good_ratio)
  return {
    name: sub.name,
    full: sub.full,
    n,
    avg,
    rate: (avg / sub.full) * 100,
    max: Math.max(...vals),
    min: Math.min(...vals),
    passRate: vals.filter((v) => v >= pass).length / n,
    goodRate: vals.filter((v) => v >= good).length / n,
    low: vals.filter((v) => v < pass).length,
  }
}

export interface ExamStats {
  full: number
  n: number
  avg: number
  /** 得分率,百分数 0-100(avg / full x 100) */
  rate: number
  max: number
  /** 最高分对应的 enrollment_id 列表 */
  maxIds: string[]
  min: number
  /** 及格率,小数 0-1 */
  passRate: number
  /** 优秀率,小数 0-1 */
  goodRate: number
  /** 总分的总体标准差(除以 n) */
  sd: number
  table: Row[]
  subjects: SubjectStats[]
}

/** ids:enrollment_id 列表;ratios:学校的及格 / 优秀比例 */
export function examStats(exam: GradebookExam, ids: string[], ratios: Grading): ExamStats | null {
  const table = examTable(exam, ids)
  const totals = table.flatMap((r) => (r.total === null ? [] : [r.total]))
  const n = totals.length
  if (n === 0) return null
  const full = examFull(exam)
  const avg = totals.reduce((a, b) => a + b, 0) / n
  const max = Math.max(...totals)
  const pass = scoreLine(full, ratios.pass_ratio)
  const good = scoreLine(full, ratios.good_ratio)
  const subjects = exam.subjects.flatMap((s) => {
    const st = subjectStats(exam, s.name, ids, ratios)
    return st ? [st] : []
  })
  return {
    full,
    n,
    avg,
    rate: (avg / full) * 100,
    max,
    maxIds: table.filter((r) => r.total === max).map((r) => r.id),
    min: Math.min(...totals),
    passRate: totals.filter((t) => t >= pass).length / n,
    goodRate: totals.filter((t) => t >= good).length / n,
    sd: Math.sqrt(totals.reduce((a, t) => a + (t - avg) ** 2, 0) / n),
    table,
    subjects,
  }
}

export interface Band {
  lo: number
  hi: number
  count: number
  tone: 'low' | 'mid' | 'good'
}

export function scoreBands(totals: number[], full: number): Band[] {
  if (!(full > 0)) return []
  const r1 = (x: number) => Math.round(x * 10) / 10
  const fullTenths = Math.round(full * 10)
  const counts = new Array<number>(10).fill(0)
  // 分数与满分都按"十分位整数"分档,避免 full/10 的浮点误差
  for (const t of totals)
    counts[Math.min(9, Math.max(0, Math.floor((Math.round(t * 10) * 10) / fullTenths)))] += 1
  const first = counts.findIndex((c) => c > 0)
  if (first < 0) return []
  const bands: Band[] = []
  for (let i = first; i < 10; i++) {
    // 十等分:lo = i/10 满分;< 60% 为 low,>= 85%(即最后一档)为 good
    bands.push({
      lo: r1((i * full) / 10),
      hi: r1(((i + 1) * full) / 10),
      count: counts[i],
      tone: i < 6 ? 'low' : i >= 9 ? 'good' : 'mid',
    })
  }
  return bands
}

export function trendDomain(values: number[]): [number, number] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return [Math.max(0, Math.floor((lo - 4) / 5) * 5), Math.min(100, Math.ceil((hi + 4) / 5) * 5)]
}

function hasScore(exam: GradebookExam): boolean {
  return Object.values(exam.scores).some((rec) =>
    Object.values(rec).some((v) => typeof v === 'number'),
  )
}

/** Any numeric score in the exam's scores map counts (the gradebook only contains active enrollments). */
export function latestExam(book: GradebookExam[]): GradebookExam | null {
  for (let i = book.length - 1; i >= 0; i--) if (hasScore(book[i])) return book[i]
  return null
}

/** Any numeric score in the exam's scores map counts (the gradebook only contains active enrollments). */
export function previousExam(book: GradebookExam[], examId: string): GradebookExam | null {
  const at = book.findIndex((e) => e.id === examId)
  if (at < 0) return null
  for (let i = at - 1; i >= 0; i--) if (hasScore(book[i])) return book[i]
  return null
}

export function rankChanges(cur: Row[], prev: Row[] | null): Map<string, number> {
  const out = new Map<string, number>()
  if (!prev) return out
  const before = new Map(prev.map((r) => [r.id, r.rank]))
  for (const r of cur) {
    const p = before.get(r.id)
    if (r.rank !== null && p !== null && p !== undefined) out.set(r.id, p - r.rank)
  }
  return out
}

export interface Attention {
  risers: { id: string; change: number }[]
  fallers: { id: string; change: number }[]
  failing: { id: string; count: number }[]
}

/** ratios:学校的及格 / 优秀比例;failing = 两科及以上低于及格线 */
export function attention(
  exam: GradebookExam,
  cur: Row[],
  changes: Map<string, number>,
  ratios: Grading,
): Attention {
  const entries = [...changes].map(([id, change]) => ({ id, change }))
  const risers = entries
    .filter((e) => e.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 5)
  const fallers = entries
    .filter((e) => e.change <= -5)
    .sort((a, b) => a.change - b.change)
    .slice(0, 6)
  const failing = cur
    .map((r) => ({
      id: r.id,
      count: exam.subjects.filter((s) => {
        const v = r.subs[s.name]
        return typeof v === 'number' && v < scoreLine(s.full, ratios.pass_ratio)
      }).length,
    }))
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  return { risers, fallers, failing }
}

/** rate: percent 0-100 (total / full x 100), same unit as SubjectStats.rate and ExamStats.rate */
export interface TrendPoint {
  examId: string
  name: string
  total: number | null
  rank: number | null
  n: number
  rate: number | null
}

/** id 与 ids 都是 enrollment_id(不是 student_id) */
export function studentTrend(book: GradebookExam[], id: string, ids: string[]): TrendPoint[] {
  return book.map((exam) => {
    const table = examTable(exam, ids)
    const row = table.find((r) => r.id === id)
    const total = row?.total ?? null
    const full = examFull(exam)
    return {
      examId: exam.id,
      name: exam.name,
      total,
      rank: row?.rank ?? null,
      n: table.filter((r) => r.total !== null).length,
      rate: total === null || full === 0 ? null : (total / full) * 100,
    }
  })
}

export function rankTint(rank: number, n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.floor(((rank - 1) / n) * 5) + 1) as 1 | 2 | 3 | 4 | 5
}
