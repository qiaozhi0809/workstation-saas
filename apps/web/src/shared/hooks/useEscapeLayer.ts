import { useEffect, useLayoutEffect, useRef } from 'react'

// 模块级栈:按注册先后排列当前激活的可关闭层(抽屉、弹层、点名卡……)。
// 只挂一个 window keydown 监听;按 Esc 时只关最上面(最后注册且仍激活)的那一层。
const stack: { close: () => void }[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top.close()
}

export function useEscapeLayer(active: boolean, onClose: () => void): void {
  const latest = useRef(onClose)
  useLayoutEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    if (!active) return
    const layer = { close: () => latest.current() }
    stack.push(layer)
    if (stack.length === 1) window.addEventListener('keydown', onKeyDown)
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) window.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
