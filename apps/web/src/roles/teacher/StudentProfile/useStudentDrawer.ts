import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** 档案抽屉的页签,顺序即显示顺序;StudentProfileDrawer 用同一份列表。 */
export const PROFILE_TABS = ['概览', '档案', '成绩', '成长记录', '评语'] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

const isTab = (v: string | null): v is ProfileTab => PROFILE_TABS.some((t) => t === v)

/**
 * 档案抽屉的开关与页签都放在地址参数里:`?student=<id>&tab=<页签>`,任何教师页都能打开。
 * tab 缺省或不认识 = '概览'。open / close 保留其余参数(例如 ?mode=、?exam=),并且 replace,
 * 这样"返回"不会重新打开抽屉。
 */
export function useStudentDrawer(): {
  studentId: string | null
  tab: ProfileTab
  /** 打开某个学生的档案;tab 缺省或为 '概览' 时不写 tab 参数 */
  open(id: string, tab?: ProfileTab): void
  /** 关闭抽屉:同时去掉 student 与 tab */
  close(): void
} {
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') || null
  const raw = params.get('tab')
  const tab: ProfileTab = isTab(raw) ? raw : '概览'

  const open = useCallback((id: string, next?: ProfileTab) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('student', id)
      if (next && next !== '概览') p.set('tab', next)
      else p.delete('tab')
      return p
    }, { replace: true })
  }, [setParams])

  const close = useCallback(() => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.delete('student')
      p.delete('tab')
      return p
    }, { replace: true })
  }, [setParams])

  return { studentId, tab, open, close }
}
