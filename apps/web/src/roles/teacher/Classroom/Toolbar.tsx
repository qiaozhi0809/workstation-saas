import type { ReactNode, RefObject } from 'react'
import { Dices, Maximize2, Minimize2, PanelRight, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import type { ClassroomViewportHandle } from '@/shared/components/ClassroomMap/types'
import { Button, buttonVariants } from '@/shared/components/ui/button'

// 其他段尚未迁移的按钮仍引用它,统一换成 outline 小按钮
// eslint-disable-next-line react-refresh/only-export-components
export const toolButton = buttonVariants({ variant: 'outline', size: 'sm' })

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
        <Button size="sm" onClick={onPick} disabled={picking}>
          <Dices aria-hidden />随机点名
        </Button>
      )}
      {extra}
      {status && <span role="status" className="text-sm text-muted-foreground">{status}</span>}
      <div className="ml-auto flex items-center gap-2">
        <div role="group" aria-label="缩放" className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="缩小" title="缩小" onClick={() => viewport.current?.zoomOut()}>
            <ZoomOut aria-hidden />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="适应" title="适应" onClick={() => viewport.current?.fit()}>
            <Scan aria-hidden />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="放大" title="放大" onClick={() => viewport.current?.zoomIn()}>
            <ZoomIn aria-hidden />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={onTogglePresent}>
          {presenting ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {presenting ? '退出全屏' : '全屏'}
        </Button>
        {!presenting && (
          <Button variant="outline" size="sm" aria-pressed={railOpen} onClick={onToggleRail}>
            <PanelRight aria-hidden />概况栏
          </Button>
        )}
      </div>
    </div>
  )
}
