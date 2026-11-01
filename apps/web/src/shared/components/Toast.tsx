import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

interface ToastAction { label: string; onClick(): void }
interface ToastItem { id: number; text: string; action?: ToastAction; ms: number }

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let seq = 0

const dismiss = (id: number) => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }))

// eslint-disable-next-line react-refresh/only-export-components
export function toast(text: string, opts: { action?: ToastAction; ms?: number } = {}): void {
  const item: ToastItem = { id: ++seq, text, action: opts.action, ms: opts.ms ?? 3000 }
  useToasts.setState((s) => ({ items: [...s.items, item] }))
}

function ToastRow({ item }: { item: ToastItem }) {
  const { id, ms } = item
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), ms)
    return () => clearTimeout(t)
  }, [id, ms])
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink px-4 py-2 text-sm text-white shadow-lg">
      <span>{item.text}</span>
      {item.action && (
        <button type="button" className="font-semibold text-amber"
          onClick={() => { dismiss(id); item.action!.onClick() }}>
          {item.action.label}
        </button>
      )}
    </div>
  )
}

// 全屏时只有全屏元素的子树可见:提示条跟着挂进全屏元素
function useHost(): Element {
  const [fs, setFs] = useState<Element | null>(() => document.fullscreenElement ?? null)
  useEffect(() => {
    const sync = () => setFs(document.fullscreenElement ?? null)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return fs?.isConnected ? fs : document.body
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  const host = useHost()
  // 卸载时清空,未显示的提示不会留给下一次挂载
  useEffect(() => () => useToasts.setState({ items: [] }), [])
  return createPortal(
    <div role="status" aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => <ToastRow key={t.id} item={t} />)}
    </div>,
    host,
  )
}
