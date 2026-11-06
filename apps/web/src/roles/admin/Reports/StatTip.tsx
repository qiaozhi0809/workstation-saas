import { useId, useState } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * 可聚焦的提示(L41):title 只在鼠标悬停时可见,键盘聚焦与触屏都看不到。
 * 数值做成按钮:悬停、键盘聚焦时显示提示,点一下(触屏)固定显示、再点或焦点移开收起;
 * aria-describedby 让读屏在聚焦时念出提示。提示放在数值上方、右对齐并限宽(自然折成两行):
 * 表格容器横向滚动时向左的溢出会被裁掉,向下伸出最后一行则会撑出竖向滚动条,这样放两者都避开。
 */
export default function StatTip({ text, tip }: { text: string; tip: string }) {
  const id = useId()
  const [pinned, setPinned] = useState(false)
  return (
    <span
      className="group relative inline-block"
      onBlur={(e) => {
        const next = e.relatedTarget
        if (!(next instanceof Node && e.currentTarget.contains(next))) setPinned(false)
      }}
    >
      <button
        type="button"
        aria-describedby={id}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setPinned(false)
        }}
        className="peer rounded tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {text}
      </button>
      <span
        id={id}
        role="tooltip"
        data-open={pinned || undefined}
        className={cn(
          'pointer-events-none absolute bottom-full right-0 z-10 mb-1 hidden w-max max-w-[9rem] rounded-md border bg-popover px-2 py-1 text-left text-xs font-normal text-popover-foreground shadow-md',
          'group-hover:block peer-focus-visible:block data-[open]:block',
        )}
      >
        {tip}
      </span>
    </span>
  )
}
