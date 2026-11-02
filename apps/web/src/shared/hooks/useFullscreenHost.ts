import { useEffect, useState } from 'react'

// 全屏时只有全屏元素的子树可见:弹层和提示条跟着挂进全屏元素
export function useFullscreenHost(): HTMLElement {
  const [fs, setFs] = useState<Element | null>(() => document.fullscreenElement ?? null)
  useEffect(() => {
    const sync = () => setFs(document.fullscreenElement ?? null)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return fs?.isConnected ? (fs as HTMLElement) : document.body
}
