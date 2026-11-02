import { useEffect, useState } from 'react'

/** 当前窗口宽度,随 resize 更新(不用 matchMedia:测试靠赋值 window.innerWidth 控制宽度)。 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}
