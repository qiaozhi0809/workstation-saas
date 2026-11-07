import type { GradebookExam, ScoreValue } from '../types/grades'
import type { Grading } from '../types/school'

/** 学校没配置时的及格 / 优秀比例;只给测试与加载中占位用,页面一律传 useGrading() 的值 */
export const DEFAULT_GRADING: Grading = { pass_ratio: 0.6, good_ratio: 0.85 }

export type Parsed = number | 'absent' | 'clear' | 'invalid'

/** 全角 ASCII(！-～,含数字、Ｘ、／、－、．)一律与半角同义;句号也当小数点 */
export function parseScore(text: string): Parsed {
  const s = text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/。/g, '.')
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

/**
 * 总分按满分十等分分档;ratios 是学校的及格 / 优秀比例(useGrading()):
 * 一档整体低于及格线(上界 ≤ 及格比例)为 low,整体不低于优秀线(下界 ≥ 优秀比例)为 good,跨线的档为 mid。
 */
export function scoreBands(totals: number[], full: number, ratios: Grading): Band[] {
  if (!(full > 0)) return []
  const r1 = (x: number) => Math.round(x * 10) / 10
  const fullTenths = Math.round(full * 10)
  const counts = new Array<number>(10).fill(0)
  // 分数与满分都按"十分位整数"分档,避免 full/10 的浮点误差
  for (const t of totals)
    counts[Math.min(9, Math.max(0, Math.floor((Math.round(t * 10) * 10) / fullTenths)))] += 1
  const first = counts.findIndex((c) => c > 0)
  if (first < 0) return []
  // 比例按整数百分比比较(比例本身只有两位小数),与档的 10% 边界同一尺度
  const passPct = Math.round(ratios.pass_ratio * 100)
  const goodPct = Math.round(ratios.good_ratio * 100)
  const bands: Band[] = []
  for (let i = first; i < 10; i++) {
    const loPct = i * 10
    const hiPct = (i + 1) * 10
    bands.push({
      lo: r1((i * full) / 10),
      hi: r1(((i + 1) * full) / 10),
      count: counts[i],
      tone: hiPct <= passPct ? 'low' : loPct >= goodPct ? 'good' : 'mid',
    })
  }
  return bands
}

/**
 * 得分率趋势图的纵轴范围:上下各留 4 个百分点、取到 5 的倍数、限在 0–100 内;
 * 再把跨度补到 20 的倍数——recharts 固定范围时画 5 个刻度(4 段),跨度是 20 的倍数每段才是 5 的倍数,
 * 不会出现 64%、81% 这类刻度(L16)。优先往上补,顶到 100 再往下补。
 */
export function trendDomain(values: number[]): [number, number] {
  // 空数组、NaN、±Infinity 都退回 0–100,否则下面补跨度的循环永远停不下来
  if (values.length === 0 || !values.every(Number.isFinite)) return [0, 100]
  let lo = Math.max(0, Math.floor((Math.min(...values) - 4) / 5) * 5)
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 4) / 5) * 5)
  while ((hi - lo) % 20 !== 0) {
    if (hi < 100) hi += 5
    else lo -= 5
  }
  return [lo, hi]
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

/**
 * 进退步口径(L16),文案与计算只在这里定义:
 * - 文案 RANK_CHANGE_BASIS 给界面说明用;
 * - 计算是下面的 previousExam:按成绩册顺序往前找最近一场有分数的考试,**不按 exam_type 筛选**
 *   (L255 / v1.1 Q3 裁定:不做"同类考试"比较——期中的上一场可能是月考,界面上也没有"同类"字样;
 *   grades.test.ts 把"忽略类型"钉住了。若将来用户要"期中比上学期期中",改这里加类型比较并同步改文案与测试);
 * - BIG_MOVE 是"大幅进退步"的门槛,attention() 的退步名单与界面标题共用。
 * 改口径时三者一起改。
 */
export const RANK_CHANGE_BASIS = '与上一场有分数的考试比'
export const BIG_MOVE = 5

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

/** ratios:学校的及格 / 优秀比例;fallers = 退步 BIG_MOVE 名及以上;failing = 两科及以上低于及格线 */
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
    .filter((e) => e.change <= -BIG_MOVE)
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
