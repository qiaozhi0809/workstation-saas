import type { ReactNode, RefObject } from 'react'
import type { ClassroomViewportHandle } from '@/shared/components/ClassroomMap/types'

export const toolButton =
  'rounded-lg border border-line-2 bg-panel px-3 py-1 text-sm text-ink hover:bg-fill disabled:cursor-not-allowed disabled:opacity-50'

/**
 * 教室工具栏。顺序:随机点名(传了 onPick 才显示)→ 各模式附加按钮(extra)→ 进行中状态(status)
 * → 缩小 / 适应 / 放大 → 全屏 → 概况栏(投屏时不显示)。
 */
export default function Toolbar({
  onPick, picking = false, viewport, presenting, onTogglePresent, railOpen, onToggleRail, extra, status,
}: {
  onPick?: () => void
  picking?: boolean
  viewport: RefObject<ClassroomViewportHandle>
  presenting: boolean
  onTogglePresent(): void
  railOpen: boolean
  onToggleRail(): void
  extra?: ReactNode
  /** 进行中的操作(如“加载中…”),给出时显示并朗读 */
  status?: string
}) {
  return (
    <div role="toolbar" aria-label="教室工具" className="flex flex-wrap items-center gap-2">
      {onPick && (
        <button type="button" className={toolButton} onClick={onPick} disabled={picking}>随机点名</button>
      )}
      {extra}
      {status && <span role="status" className="text-sm text-ink-2">{status}</span>}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className={toolButton} onClick={() => viewport.current?.zoomOut()}>缩小</button>
          <button type="button" className={toolButton} onClick={() => viewport.current?.fit()}>适应</button>
          <button type="button" className={toolButton} onClick={() => viewport.current?.zoomIn()}>放大</button>
        </div>
        <button type="button" className={toolButton} onClick={onTogglePresent}>{presenting ? '退出全屏' : '全屏'}</button>
        {!presenting && (
          <button type="button" className={toolButton} aria-pressed={railOpen} onClick={onToggleRail}>概况栏</button>
        )}
      </div>
    </div>
  )
}
