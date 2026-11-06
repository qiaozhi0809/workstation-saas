import { useCallback, useRef, useState } from 'react'
import { useAuthStore } from '@/shared/stores/auth'
import type { UpgradePlan } from '@/shared/types/admin'
import type { StepKey } from './errors'
import { normalizePlan } from './planOps'

export const DRAFT_KEY = 'ws-upgrade-draft'
/** 草稿存档结构版本;读到别的版本(或没有)一律丢弃 */
const DRAFT_VERSION = 2

export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'year', label: '新学年' },
  { key: 'classes', label: '班级去向' },
  { key: 'students', label: '学生例外' },
  { key: 'newClasses', label: '新建班级' },
  { key: 'people', label: '人员' },
  { key: 'preview', label: '预览' },
]

export interface Draft {
  step: StepKey
  year: { name: string; start_date: string; end_date: string }
  plan: UpgradePlan | null
  ui: {
    /** 学生例外步骤里当前看的班 */
    studentClassId: string | null
    /** 选过的人:user_id / 方案里的老师 id → 姓名(类型里新建班没有 teacher_name 字段) */
    names: Record<string, string>
    /** 标了例外的学生 enrollment_id → 他所在的旧班(后端报错时据此跳回对应班) */
    studentClasses: Record<string, string>
  }
}

const emptyDraft = (): Draft => ({
  step: 'year',
  year: { name: '', start_date: '', end_date: '' },
  plan: null,
  ui: { studentClassId: null, names: {}, studentClasses: {} },
})

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function read(owner: string | null): Draft {
  const base = emptyDraft()
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return base
    const d: unknown = JSON.parse(raw)
    const planOk = (p: unknown) =>
      isObj(p) && Array.isArray(p.classes) && typeof p.from_year_id === 'string'
    // 结构不对、版本不对、别人的草稿:丢弃并清掉
    if (
      !isObj(d) ||
      d.v !== DRAFT_VERSION ||
      (d.owner ?? null) !== owner ||
      (d.plan != null && !planOk(d.plan))
    ) {
      drop()
      return base
    }
    const year = isObj(d.year) ? d.year : {}
    const ui = isObj(d.ui) ? d.ui : {}
    const plan = isObj(d.plan) ? normalizePlan(d.plan as unknown as UpgradePlan) : null
    const step = STEPS.some((s) => s.key === d.step) ? (d.step as StepKey) : 'year'
    return {
      step: plan ? step : 'year',
      year: {
        name: typeof year.name === 'string' ? year.name : '',
        start_date: typeof year.start_date === 'string' ? year.start_date : '',
        end_date: typeof year.end_date === 'string' ? year.end_date : '',
      },
      plan,
      ui: {
        studentClassId: typeof ui.studentClassId === 'string' ? ui.studentClassId : null,
        names: isObj(ui.names) ? (ui.names as Record<string, string>) : {},
        studentClasses: isObj(ui.studentClasses)
          ? (ui.studentClasses as Record<string, string>)
          : {},
      },
    }
  } catch {
    drop()
    return base
  }
}

function write(d: Draft, owner: string | null) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, owner, ...d }))
  } catch {
    /* 存不下就只留在内存里 */
  }
}

function drop() {
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 同上 */
  }
}

// 登出 / 换号即清草稿(L54):订阅登录态而不是在 logout() 的调用处加钩子,
// 令牌失效、被踢下线、另一标签登出等每条登出路径都会经过这里;同一用户刷新令牌不算
useAuthStore.subscribe((state, prev) => {
  const was = prev.user?.id
  if (was && state.user?.id !== was) drop()
})

/** 升级方案草稿:每次改动写入 localStorage(读写都容错),执行成功或放弃后清除 */
export function useUpgradeDraft() {
  const owner = useAuthStore((s) => s.user?.id ?? null)
  const [draft, setDraft] = useState<Draft>(() => read(owner))
  // 当前草稿放在 ref 里:连续多次更新互相可见,存档在事件处理里做,不放进 setState 更新函数
  const current = useRef(draft)

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      const next = fn(current.current)
      if (next === current.current) return
      current.current = next
      write(next, owner)
      setDraft(next)
    },
    [owner],
  )

  return {
    draft,
    setStep: useCallback((step: StepKey) => update((d) => ({ ...d, step })), [update]),
    // 方案已经生成时,学年名称和日期同步写进 plan.new_year
    setYear: useCallback(
      (patch: Partial<Draft['year']>) =>
        update((d) => ({
          ...d,
          year: { ...d.year, ...patch },
          plan: d.plan ? { ...d.plan, new_year: { ...d.plan.new_year, ...patch } } : d.plan,
        })),
      [update],
    ),
    setPlan: useCallback((plan: UpgradePlan | null) => update((d) => ({ ...d, plan })), [update]),
    editPlan: useCallback(
      (fn: (p: UpgradePlan) => UpgradePlan) =>
        update((d) => (d.plan ? { ...d, plan: fn(d.plan) } : d)),
      [update],
    ),
    setUi: useCallback(
      (patch: Partial<Draft['ui']>) => update((d) => ({ ...d, ui: { ...d.ui, ...patch } })),
      [update],
    ),
    rememberNames: useCallback(
      (names: Record<string, string>) =>
        update((d) => ({ ...d, ui: { ...d.ui, names: { ...d.ui.names, ...names } } })),
      [update],
    ),
    clear: useCallback(() => {
      drop()
      current.current = emptyDraft()
      setDraft(current.current)
    }, []),
  }
}

export type UpgradeDraft = ReturnType<typeof useUpgradeDraft>
