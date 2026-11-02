import { create } from 'zustand'

/** 有“未保存改动”概念的来源:排座草稿、成绩自动保存队列 */
export type UnsavedKey = 'seating' | 'scores'

interface TeacherState {
  classId: string | null
  /** 各来源是否有未保存改动(切换班级、退出登录前要先确认) */
  unsaved: Record<UnsavedKey, boolean>
  setClass: (id: string) => void
  setUnsaved: (key: UnsavedKey, dirty: boolean) => void
}

export const useTeacherStore = create<TeacherState>()((set) => ({
  classId: null,
  unsaved: { seating: false, scores: false },
  setClass: (classId) => set({ classId }),
  setUnsaved: (key, dirty) => set((s) => ({ unsaved: { ...s.unsaved, [key]: dirty } })),
}))

export const SEATING_LEAVE_CONFIRM = '有未保存的座位修改,确定离开吗?'
export const SCORES_LEAVE_CONFIRM = '还有成绩没保存,确定离开?'

const LEAVE_CONFIRM: Record<UnsavedKey, string> = {
  seating: SEATING_LEAVE_CONFIRM,
  scores: SCORES_LEAVE_CONFIRM,
}
const ALL_KEYS: UnsavedKey[] = ['seating', 'scores']

/**
 * 给定来源(默认全部)里没有未保存改动,或老师确认放弃时返回 true。
 * 确认放弃后清掉这些来源的标记:调用方随后就离开,各页面的路由守卫不会再问第二次。
 */
export function confirmLeave(keys: UnsavedKey[] = ALL_KEYS): boolean {
  const { unsaved, setUnsaved } = useTeacherStore.getState()
  const dirty = keys.filter((k) => unsaved[k])
  if (dirty.length === 0) return true
  if (!window.confirm(LEAVE_CONFIRM[dirty[0]])) return false
  for (const k of dirty) setUnsaved(k, false)
  return true
}
