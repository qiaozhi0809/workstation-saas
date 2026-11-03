import { Undo2 } from 'lucide-react'
import { MenuItem } from '@/shared/components/overlay/Menu'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import type { DeskSize } from '@/shared/types/seating'
import type { DraftStudent } from './draft'

export interface SeatingBarProps {
  /** 每桌几人 */
  deskSize: DeskSize
  onOpenLayout?: () => void
  /** 有未保存的草稿时,不能改桌椅排列 */
  layoutBlocked: boolean
  canUndo: boolean
  dirty: boolean
  /** 保存或重新加载进行中 */
  busy: boolean
  /** 选中的已就座学生(未选中或选中的是待安排学生时为 null) */
  selected: DraftStudent | null
  /** 保存时版本冲突,显示对话框 */
  conflict: boolean
  onShuffle(): void
  onPair(): void
  onMentor(): void
  /** 有考试名次可用 */
  canMentor: boolean
  onUndo(): void
  onDiscard(): void
  onToggleLock(): void
  onPrint(): void
  onSave(): void
  onReload(): void
  onKeepEditing(): void
}

function ConflictDialog({ onReload, onKeepEditing }: Pick<SeatingBarProps, 'onReload' | 'onKeepEditing'>) {
  return (
    <Modal open onClose={onKeepEditing} title="座位表已被其他人修改"
      description="你的修改还没有保存。可以放弃修改并载入最新的座位表,也可以继续编辑。" dismissOnOutside={false}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onReload}>放弃我的修改并重新加载</Button>
        {/* 对话框打开时焦点落在不丢数据的选项上 */}
        <Button type="button" autoFocus onClick={onKeepEditing}>继续编辑</Button>
      </div>
    </Modal>
  )
}

/** "更多操作"菜单里排座自己的项(菜单本身由操作台渲染,与随机点名 / 编辑黑板共用一个)。 */
export function SeatingMenuItems(p: Pick<SeatingBarProps, 'busy' | 'dirty' | 'selected' | 'onDiscard' | 'onToggleLock' | 'onPrint'>) {
  return (
    <>
      <MenuItem disabled={p.busy || !p.dirty} onSelect={p.onDiscard}>放弃修改</MenuItem>
      <MenuItem disabled={p.busy || !p.selected} onSelect={p.onToggleLock}>
        {p.selected?.locked ? '取消固定' : '固定座位'}
      </MenuItem>
      <MenuItem onSelect={p.onPrint}>打印</MenuItem>
    </>
  )
}

/** 排座操作条:常用操作直接可见,放弃修改 / 固定 / 打印在操作台的"更多操作"里(SeatingMenuItems)。 */
export default function SeatingBar(p: SeatingBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <Button type="button" variant="outline" disabled={p.busy} onClick={p.onShuffle}>随机打乱</Button>
      {p.deskSize !== 1 && (
        <Button type="button" variant="outline" disabled={p.busy} onClick={p.onPair}>男女同桌</Button>
      )}
      {p.deskSize !== 1 && (
        <Button type="button" variant="outline" disabled={p.busy || !p.canMentor} title={p.canMentor ? undefined : '还没有考试成绩'}
          onClick={p.onMentor}>优带弱</Button>
      )}
      <Button type="button" variant="outline" disabled={p.busy || !p.canUndo} onClick={p.onUndo}
        aria-label="撤销" title="撤销" size="icon"><Undo2 aria-hidden /></Button>
      {p.onOpenLayout && (
        <Button type="button" variant="outline" disabled={p.busy || p.layoutBlocked}
          title={p.layoutBlocked ? '先保存或放弃当前的座位修改' : undefined} onClick={p.onOpenLayout}>桌椅排列</Button>
      )}
      <Button type="button" disabled={p.busy || !p.dirty} onClick={p.onSave}>保存座位</Button>
      {p.conflict && <ConflictDialog onReload={p.onReload} onKeepEditing={p.onKeepEditing} />}
    </div>
  )
}
