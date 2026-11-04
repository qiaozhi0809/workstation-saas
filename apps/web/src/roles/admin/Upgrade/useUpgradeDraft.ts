import { useCallback, useState } from 'react'
import type { UpgradePlan } from '@/shared/types/admin'
import type { StepKey } from './errors'
import { normalizePlan } from './planOps'

export const DRAFT_KEY = 'ws-upgrade-draft'

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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function read(): Draft {
  const base = emptyDraft()
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return base
    const d: unknown = JSON.parse(raw)
    if (!isObj(d)) return base
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
        studentClasses: isObj(ui.studentClasses) ? (ui.studentClasses as Record<string, string>) : {},
      },
    }
  } catch {
    return base
  }
}

function write(d: Draft) {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* 存不下就只留在内存里 */ }
}

function drop() {
  try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* 同上 */ }
}

/** 升级方案草稿:每次改动写入 localStorage(读写都容错),执行成功或放弃后清除 */
export function useUpgradeDraft() {
  const [draft, setDraft] = useState<Draft>(read)

  const update = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((prev) => {
      const next = fn(prev)
      write(next)
      return next
    })
  }, [])

  return {
    draft,
    setStep: useCallback((step: StepKey) => update((d) => ({ ...d, step })), [update]),
    setYear: useCallback((patch: Partial<Draft['year']>) => update((d) => ({ ...d, year: { ...d.year, ...patch } })), [update]),
    setPlan: useCallback((plan: UpgradePlan | null) => update((d) => ({ ...d, plan })), [update]),
    editPlan: useCallback((fn: (p: UpgradePlan) => UpgradePlan) =>
      update((d) => (d.plan ? { ...d, plan: fn(d.plan) } : d)), [update]),
    setUi: useCallback((patch: Partial<Draft['ui']>) => update((d) => ({ ...d, ui: { ...d.ui, ...patch } })), [update]),
    rememberNames: useCallback((names: Record<string, string>) =>
      update((d) => ({ ...d, ui: { ...d.ui, names: { ...d.ui.names, ...names } } })), [update]),
    clear: useCallback(() => { drop(); setDraft(emptyDraft()) }, []),
  }
}

export type UpgradeDraft = ReturnType<typeof useUpgradeDraft>
