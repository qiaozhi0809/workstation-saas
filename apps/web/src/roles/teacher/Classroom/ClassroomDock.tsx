import type { ReactNode, RefObject } from 'react'
import { Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Separator } from '@/shared/components/ui/separator'
import type { ClassPerm } from '@/shared/types/classroom'
import ModeBar, { type ClassroomUiMode } from './ModeBar'

export interface ClassroomDockProps {
  mode: ClassroomUiMode
  perms: readonly ClassPerm[]
  onModeChange(mode: ClassroomUiMode): void
  /** 区 2:当前模式操作 */
  actions?: ReactNode
  /** 区 3:随机点名、编辑黑板 */
  common?: ReactNode
  /** 区 4:进行中的操作(如“加载中…”),给出时显示并朗读 */
  status?: string
  presenting: boolean
  onTogglePresent(): void
  railOpen: boolean
  onToggleRail(): void
  /** 概况栏按钮,浮层关闭后把焦点还给它 */
  railButtonRef?: RefObject<HTMLButtonElement>
}

/** 舞台下方的操作台:模式 → 模式操作 → 常用操作 → 状态 → 全屏 / 概况栏。 */
export default function ClassroomDock({
  mode, perms, onModeChange, actions, common, status, presenting, onTogglePresent, railOpen, onToggleRail, railButtonRef,
}: ClassroomDockProps) {
  return (
    <div role="toolbar" aria-label="教室工具" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2 py-1.5 shadow-sm">
      <ModeBar mode={mode} perms={perms} onChange={onModeChange} />
      {/* actions 始终在同一树位置(SeatingBar 带弹层状态,不能因 common / status 出现而重挂) */}
      {actions ? <Separator orientation="vertical" className="h-6" /> : null}
      {actions}
      {common ? <Separator orientation="vertical" className="h-6" /> : null}
      {common}
      {status && <span role="status" className="text-sm text-muted-foreground">{status}</span>}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" onClick={onTogglePresent}>
          {presenting ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {presenting ? '退出全屏' : '全屏'}
        </Button>
        {!presenting && (
          <Button ref={railButtonRef} variant="outline" aria-pressed={railOpen} onClick={onToggleRail}>
            <PanelRight aria-hidden />概况栏
          </Button>
        )}
      </div>
    </div>
  )
}
