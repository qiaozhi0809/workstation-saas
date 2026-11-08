import { useCallback, useEffect, useState, type RefObject } from 'react'
import { toast } from '@/shared/components/Toast'

const UNSUPPORTED = '浏览器不支持全屏,可以按 F11'

/** 让 ref 指向的元素进入 / 退出全屏;active 跟随 fullscreenchange(含按 Esc 退出)。 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): {
  active: boolean
  toggle(): void
} {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () => setActive(!!ref.current && document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {})
      return
    }
    if (typeof el.requestFullscreen !== 'function' || document.fullscreenEnabled === false) {
      toast(UNSUPPORTED)
      return
    }
    el.requestFullscreen().catch(() => toast(UNSUPPORTED))
  }, [ref])

  return { active, toggle }
}
