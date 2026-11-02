import { create } from 'zustand'

interface TeacherState {
  classId: string | null
  /** 教室页排座模式里有未保存的座位修改(切换班级前要先确认) */
  seatingDirty: boolean
  setClass: (id: string) => void
  setSeatingDirty: (dirty: boolean) => void
}

export const useTeacherStore = create<TeacherState>()((set) => ({
  classId: null,
  seatingDirty: false,
  setClass: (classId) => set({ classId }),
  setSeatingDirty: (seatingDirty) => set({ seatingDirty }),
}))

export const SEATING_LEAVE_CONFIRM = '有未保存的座位修改,确定离开吗?'

/**
 * 没有未保存的座位修改,或老师确认放弃时返回 true。
 * 确认放弃后清掉标记:调用方随后就离开排座,教室页的路由守卫不会再问第二次。
 */
export function confirmLeaveSeating(): boolean {
  const { seatingDirty, setSeatingDirty } = useTeacherStore.getState()
  if (!seatingDirty) return true
  if (!window.confirm(SEATING_LEAVE_CONFIRM)) return false
  setSeatingDirty(false)
  return true
}
