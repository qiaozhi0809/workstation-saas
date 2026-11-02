import { useCallback, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** 档案抽屉的页签,顺序即显示顺序;StudentProfileDrawer 用同一份列表。 */
export const PROFILE_TABS = ['概览', '档案', '成绩', '成长记录', '评语'] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

const isTab = (v: string | null): v is ProfileTab => PROFILE_TABS.some((t) => t === v)

/**
 * 档案抽屉的开关与页签都放在地址参数里:`?student=<id>&tab=<页签>`,任何教师页都能打开。
 * tab 缺省或不认识 = '概览'。open / close 保留其余参数(例如 ?mode=、?exam=),并且 replace,
 * 这样"返回"不会重新打开抽屉。
 *
 * open / close 引用恒定(地址参数变化时也不变),返回对象只在 studentId / tab 变化时才换,
 * 都可以安全放进依赖数组。不要在同一个 tick 里把它们与别处的 search 参数写入混用(后写覆盖先写)。
 */
export function useStudentDrawer(): {
  studentId: string | null
  tab: ProfileTab
  /** 打开某个学生的档案(参数是 student_id,不是 enrollment_id);tab 缺省或为 '概览' 时不写 tab 参数 */
  open(id: string, tab?: ProfileTab): void
  /** 关闭抽屉:同时去掉 student 与 tab */
  close(): void
} {
  const navigate = useNavigate()
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  const studentId = params.get('student') || null
  const raw = params.get('tab')
  const tab: ProfileTab = isTab(raw) ? raw : '概览'

  // 始终读最新地址,而不是闭包里的渲染时参数,这样 open / close 不必随地址重建
  const searchRef = useRef(search)
  // 渲染期同步:子组件的 effect 先于父组件的 effect 运行,用 effect 同步会读到旧地址
  searchRef.current = search

  const write = useCallback((edit: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchRef.current)
    edit(p)
    const str = p.toString()
    searchRef.current = str ? `?${str}` : ''
    navigate({ search: searchRef.current }, { replace: true })
  }, [navigate])

  const open = useCallback((id: string, next?: ProfileTab) => write((p) => {
    p.set('student', id)
    if (next && next !== '概览') p.set('tab', next)
    else p.delete('tab')
  }), [write])

  const close = useCallback(() => write((p) => {
    p.delete('student')
    p.delete('tab')
  }), [write])

  return useMemo(() => ({ studentId, tab, open, close }), [studentId, tab, open, close])
}
