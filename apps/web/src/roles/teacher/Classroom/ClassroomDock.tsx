import type { ReactNode } from 'react'
import { Ellipsis, Maximize2, Minimize2, ListTodo, Video } from 'lucide-react'
import Menu from '@/shared/components/overlay/Menu'
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
  /** 区 3:随机点名、编辑黑板(只在日常模式直接显示) */
  common?: ReactNode
  /** 唯一的"更多操作"菜单里的 MenuItem(模式自己的项在前,随机点名 / 编辑黑板在后);不给则不显示 ⋯ */
  menu?: ReactNode
  /** 区 4:进行中的操作(如“加载中…”),给出时显示并朗读 */
  status?: string
  presenting: boolean
  onTogglePresent(): void
  /** 打开右侧"待办与点评"抽屉(抽屉自己在关闭后把焦点还给这个按钮) */
  onOpenPanel(): void
  /** "看看教室":本班有可看的摄像头时才给;open 为缩略条是否展开 */
  cameras?: { open: boolean; onToggle(): void }
}

/** 舞台下方的操作台:模式 → 模式操作 → 常用操作 → 更多操作 → 状态 → 看看教室 / 全屏 / 待办与点评。 */
export default function ClassroomDock({
  mode,
  perms,
  onModeChange,
  actions,
  common,
  menu,
  status,
  presenting,
  onTogglePresent,
  onOpenPanel,
  cameras,
}: ClassroomDockProps) {
  return (
    <div
      role="toolbar"
      aria-label="教室工具"
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2 py-1.5 shadow-sm"
    >
      <ModeBar mode={mode} perms={perms} onChange={onModeChange} />
      {/* actions 始终在同一树位置(SeatingBar 带弹层状态,不能因 common / status 出现而重挂) */}
      {actions ? <Separator orientation="vertical" className="h-6" /> : null}
      {actions}
      {common ? <Separator orientation="vertical" className="h-6" /> : null}
      {common}
      {menu ? (
        <Menu
          label="更多操作"
          side="top"
          trigger={<Ellipsis aria-hidden />}
          triggerProps={{
            variant: 'outline',
            size: 'icon',
            'aria-label': '更多操作',
            title: '更多操作',
          }}
        >
          {menu}
        </Menu>
      ) : null}
      {status && (
        <span role="status" className="text-sm text-muted-foreground">
          {status}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {cameras && (
          <Button
            variant={cameras.open ? 'secondary' : 'outline'}
            size="icon"
            aria-label="看看教室"
            title="看看教室"
            aria-pressed={cameras.open}
            data-testid="camera-toggle"
            onClick={cameras.onToggle}
          >
            <Video aria-hidden />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label={presenting ? '退出全屏' : '全屏'}
          title={presenting ? '退出全屏' : '全屏'}
          onClick={onTogglePresent}
        >
          {presenting ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </Button>
        {!presenting && (
          <Button
            variant="outline"
            size="icon"
            aria-label="待办与点评"
            title="待办与点评"
            aria-haspopup="dialog"
            onClick={onOpenPanel}
          >
            <ListTodo aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
