import { useCallback, useRef } from 'react'

// Radix 的 Dialog 在没有 Trigger 时关闭后不会把焦点还给打开前的元素:
// 打开时记下当前焦点,关闭时接管还原。
// 必须在 render 阶段于 open 由 false→true 时捕获:内容里的 autoFocus 会在同一次 commit 内、
// 早于父级 layout effect 抢走焦点,那时再读 activeElement 得到的已是对话框内部元素。
// 自动弹出的对话框(欢迎页等)没有"打开者"(记下的是 <body>):关闭后把焦点放到页面主区 #main(L243),
// 读屏 / 键盘用户从页面顶部继续,而不是落回 <body>。
export function useRestoreFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null
  wasOpen.current = open
  return useCallback((e: Event) => {
    e.preventDefault()
    const el = opener.current
    if (el && el !== document.body && el.isConnected) el.focus()
    else document.getElementById('main')?.focus()
  }, [])
}
