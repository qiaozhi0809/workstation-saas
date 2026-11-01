import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** 系统是否开启了"减少动态效果"(没有 matchMedia 的环境视为未开启)。 */
export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches

/** 同上,并随系统设置变化重新渲染。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const on = () => setReduced(mql.matches)
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return reduced
}
