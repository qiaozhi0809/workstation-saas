import type {
  GradeHeadPlan, UpgradeClassPlan, UpgradeNewClassPlan, UpgradePlan, UpgradeStudentPlan,
} from '@/shared/types/admin'

/** 与后端 NewClassPlan 的默认值一致 */
export const SEAT_DEFAULTS = { seat_rows: 7, seat_cols: 4, desk_size: 2, seat_layout: 'auto' } as const

export const newClassRow = (): UpgradeNewClassPlan => ({
  grade_name: '', name: '', homeroom_teacher_id: null, ...SEAT_DEFAULTS,
})

type Loose<T> = { [K in keyof T]?: T[K] | null }

/** 后端响应(或旧草稿)可能缺字段:补齐必填项,保证前端和请求体里都是完整结构 */
export function normalizePlan(raw: UpgradePlan): UpgradePlan {
  const r = raw as Omit<UpgradePlan, 'classes' | 'students' | 'new_classes'> & {
    classes?: Loose<UpgradeClassPlan>[] | null
    students?: UpgradeStudentPlan[] | null
    new_classes?: Loose<UpgradeNewClassPlan>[] | null
  }
  return {
    ...r,
    classes: (r.classes ?? []).map((c) => ({ ...c, keep_teachers: c.keep_teachers ?? true }) as UpgradeClassPlan),
    students: r.students ?? [],
    new_classes: (r.new_classes ?? []).map((n) => ({
      grade_name: n.grade_name ?? '',
      name: n.name ?? '',
      homeroom_teacher_id: n.homeroom_teacher_id ?? null,
      seat_rows: n.seat_rows ?? SEAT_DEFAULTS.seat_rows,
      seat_cols: n.seat_cols ?? SEAT_DEFAULTS.seat_cols,
      desk_size: n.desk_size ?? SEAT_DEFAULTS.desk_size,
      seat_layout: n.seat_layout ?? SEAT_DEFAULTS.seat_layout,
    })),
    grade_heads: r.grade_heads ?? null,
  }
}

/** 新学年实际出现的年级(升级班的新年级名 + 新建班的年级名),按出现顺序去重 */
export function gradeNames(plan: UpgradePlan): string[] {
  const out: string[] = []
  const add = (g: string | null | undefined) => {
    const name = g?.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  plan.classes.forEach((c) => { if (c.action === 'promote') add(c.to_grade_name) })
  plan.new_classes.forEach((n) => add(n.grade_name))
  return out
}

/**
 * 年级组长与新学年的年级对齐:去掉失效的行,补上新年级的空行。null(旧规则)保持不变。
 * 恰好一个旧年级名消失、恰好一个新年级名出现时,视为改名,组长迁移到新名。
 */
export function syncGradeHeads(plan: UpgradePlan): UpgradePlan {
  if (!Array.isArray(plan.grade_heads)) return plan
  const grades = gradeNames(plan)
  const prev = new Map<string, string[]>()
  plan.grade_heads.forEach((g) => prev.set(g.grade_name.trim(), g.user_ids))
  const removed = [...prev.keys()].filter((k) => !grades.includes(k))
  const added = grades.filter((g) => !prev.has(g))
  const renamed = removed.length === 1 && added.length === 1 ? { from: removed[0], to: added[0] } : null
  const heads: GradeHeadPlan[] = grades.map((g) => ({
    grade_name: g,
    user_ids: prev.get(g) ?? (renamed?.to === g ? (prev.get(renamed.from) ?? []) : []),
  }))
  return { ...plan, grade_heads: heads }
}

/** 年级名变化后,有组长没能沿用(会被丢掉)吗 */
export function lostGradeHeads(plan: UpgradePlan): boolean {
  if (!Array.isArray(plan.grade_heads)) return false
  const grades = gradeNames(plan)
  const kept = new Set((syncGradeHeads(plan).grade_heads ?? []).flatMap((h) => h.user_ids))
  return plan.grade_heads.some((h) => !grades.includes(h.grade_name.trim()) && h.user_ids.some((id) => !kept.has(id)))
}

export function setGradeHead(plan: UpgradePlan, grade: string, userIds: string[]): UpgradePlan {
  const base = syncGradeHeads({ ...plan, grade_heads: plan.grade_heads ?? [] })
  const heads = (base.grade_heads ?? []).map((g) => (g.grade_name === grade ? { ...g, user_ids: userIds } : g))
  return { ...plan, grade_heads: heads }
}

/** 删除第 i 个新建班:指向它的留级学生行一并删除,更大的序号顺延 */
export function removeNewClass(plan: UpgradePlan, i: number): UpgradePlan {
  return {
    ...plan,
    new_classes: plan.new_classes.filter((_, j) => j !== i),
    students: plan.students
      .filter((s) => s.to?.new_class !== i)
      .map((s) => (s.to?.new_class != null && s.to.new_class > i ? { ...s, to: { new_class: s.to.new_class - 1 } } : s)),
  }
}

/** 发给后端的方案:补齐必填字段;grade_heads 只在有数组时与年级对齐,null 表示沿用旧规则 */
export function toRequest(plan: UpgradePlan): UpgradePlan {
  const n = normalizePlan(plan)
  const trim = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : v)
  return syncGradeHeads({
    ...n,
    // 年级名 / 班名统一去掉首尾空格,保证 grade_heads 与 classes / new_classes 里的写法一致
    classes: n.classes.map((c) => ({ ...c, to_grade_name: trim(c.to_grade_name), to_name: trim(c.to_name) })),
    new_classes: n.new_classes.map((x) => ({ ...x, grade_name: x.grade_name.trim(), name: x.name.trim() })),
  })
}

export const targetKey = (to: UpgradeStudentPlan['to']): string =>
  to?.successor_of ? `s:${to.successor_of}` : to?.new_class != null ? `n:${to.new_class}` : ''

export interface Target { key: string; label: string; to: NonNullable<UpgradeStudentPlan['to']> }

/** 留级只能去同年级的班:某升级班的继任班,或同年级的新建班。年级未知时不过滤 */
export function repeatTargets(plan: UpgradePlan, grade: string | null): Target[] {
  const out: Target[] = []
  plan.classes.forEach((c) => {
    if (c.action === 'promote' && (grade === null || c.to_grade_name?.trim() === grade))
      out.push({ key: `s:${c.from_class_id}`, label: `${c.to_grade_name ?? ''} ${c.to_name ?? ''}(${c.from_name ?? '原班'}的继任班)`, to: { successor_of: c.from_class_id } })
  })
  plan.new_classes.forEach((n, j) => {
    if (grade === null || n.grade_name.trim() === grade)
      out.push({ key: `n:${j}`, label: `新建班${j + 1} ${n.grade_name} ${n.name}`, to: { new_class: j } })
  })
  return out
}
