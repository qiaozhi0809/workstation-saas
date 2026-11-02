import { useCallback, useLayoutEffect, useRef } from 'react'

// Radix 的 Dialog 在没有 Trigger 时关闭后不会把焦点还给打开前的元素:
// 打开时记下当前焦点,关闭时接管还原。
export function useRestoreFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null
  }, [open])
  return useCallback((e: Event) => {
    e.preventDefault()
    const el = opener.current
    if (el?.isConnected) el.focus()
  }, [])
}
