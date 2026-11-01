import { create } from 'zustand'

interface TeacherState {
  classId: string | null
  setClass: (id: string) => void
}

export const useTeacherStore = create<TeacherState>()((set) => ({
  classId: null,
  setClass: (classId) => set({ classId }),
}))
