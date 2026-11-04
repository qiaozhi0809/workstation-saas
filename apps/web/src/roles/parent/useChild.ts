import { createContext, useContext, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { parentApi } from '@/shared/api/parent'
import type { ParentChild } from '@/shared/types/parent'

const KEY = 'ws-parent-child'

const remembered = (): string | null => {
  try { return localStorage.getItem(KEY) } catch { return null }
}
const remember = (id: string) => {
  try { localStorage.setItem(KEY, id) } catch { /* 无存储环境:只靠地址栏 */ }
}

/** 当前孩子:?child= → 上次记住的 → 列表第一个;不在列表里的 id 自动换成第一个并改写地址栏。active=false 时不发请求、不改地址栏 */
export function useChildState(active = true) {
  const list = useQuery({ queryKey: ['parent', 'children'], queryFn: parentApi.children, enabled: active })
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  // 不用 setSearchParams:在布局路由里它按布局路径(/parent)解析,会把子页面的路径冲掉
  const withChild = (id: string) => {
    const n = new URLSearchParams(location.search)
    n.set('child', id)
    return { pathname: location.pathname, search: `?${n.toString()}`, hash: location.hash }
  }
  const children = list.data
  const wanted = params.get('child') ?? remembered()
  const child: ParentChild | null = children ? (children.find((c) => c.student_id === wanted) ?? children[0] ?? null) : null
  const id = child?.student_id ?? null

  useEffect(() => {
    if (!id || !active) return
    remember(id)
    // /parent 本身由 ParentIndex 带着 child 跳转,这里不插手
    if (params.get('child') !== id && !/^\/parent\/?$/.test(location.pathname)) navigate(withChild(id), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, location.pathname, location.search])

  const select = (next: string) => navigate(withChild(next))

  return { list, children: children ?? [], child, select }
}

export type ChildState = ReturnType<typeof useChildState>

/** 布局只算一次,子页从这里读 */
export const ChildContext = createContext<ChildState | null>(null)

/** 子页取当前孩子:在 ParentLayout 之内读它提供的值;单独渲染时(没有布局)自己算 */
export function useChild(): ChildState {
  const shared = useContext(ChildContext)
  const own = useChildState(!shared)
  return shared ?? own
}
