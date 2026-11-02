import { ChevronDown, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { MenuItem } from '@/shared/components/overlay/Menu'
import Modal from '@/shared/components/overlay/Modal'
import Popover from '@/shared/components/overlay/Popover'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import type { DraftStudent } from './draft'

const MIN_SIZE = 1
const MAX_SIZE = 12
// 隐藏浏览器自带的上下箭头:它们逐次触发 change,改由两侧的步进按钮提交
const sizeInput = 'h-8 w-12 px-1 text-center [appearance:textfield] '
  + '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none '
  + 'aria-[invalid=true]:border-destructive'

export interface SeatingBarProps {
  rows: number
  cols: number
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
  onResize(rows: number, cols: number): void
  onToggleLock(): void
  onPrint(): void
  onSave(): void
  onReload(): void
  onKeepEditing(): void
}

const clamp = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)))

// 输入过程中只改输入框里的文字;失焦、按 Enter 或点步进按钮才调整网格,
// 否则从 6 排改成 10 排时会先变成 1 排,把后排学生挤进待安排
function SizeInput({ label, value, disabled, autoFocus, onChange }: { label: string; value: number; disabled: boolean; autoFocus?: boolean; onChange(n: number): void }) {
  const [text, setText] = useState<string | null>(null)
  const typed = text === null ? value : Number(text)
  const invalid = text !== null && !(text.trim() !== '' && Number.isInteger(typed) && typed >= MIN_SIZE && typed <= MAX_SIZE)
  const apply = (n: number) => {
    setText(null)
    const next = clamp(n)
    if (next !== value) onChange(next)
  }
  const commit = () => {
    if (text === null) return
    if (text.trim() === '' || !Number.isFinite(typed)) setText(null)
    else apply(typed)
  }
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={`seat-size-${label}`}>{label}</label>
      <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label={`减少${label}`}
        disabled={disabled || value <= MIN_SIZE} onClick={() => apply(value - 1)}>−</Button>
      <Input id={`seat-size-${label}`} type="number" className={sizeInput} min={MIN_SIZE} max={MAX_SIZE}
        value={text ?? value} disabled={disabled} aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)}
        data-autofocus={autoFocus ? '' : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            apply(value + (e.key === 'ArrowUp' ? 1 : -1))
          }
        }} />
      <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label={`增加${label}`}
        disabled={disabled || value >= MAX_SIZE} onClick={() => apply(value + 1)}>+</Button>
    </div>
  )
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

/** 排座操作条:常用操作直接可见,行列收进弹层;放弃修改 / 固定 / 打印在操作台的"更多操作"里(SeatingMenuItems)。 */
export default function SeatingBar(p: SeatingBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <Button type="button" variant="outline" disabled={p.busy} onClick={p.onShuffle}>随机打乱</Button>
      <Button type="button" variant="outline" disabled={p.busy} onClick={p.onPair}>男女同桌</Button>
      <Button type="button" variant="outline" disabled={p.busy || !p.canMentor} title={p.canMentor ? undefined : '还没有考试成绩'}
        onClick={p.onMentor}>优带弱</Button>
      <Button type="button" variant="outline" disabled={p.busy || !p.canUndo} onClick={p.onUndo}
        aria-label="撤销" title="撤销" size="icon"><Undo2 aria-hidden /></Button>
      <Popover label="座位行列" side="top" triggerProps={{ variant: 'outline', disabled: p.busy }}
        trigger={<>{`${p.rows} 排 × ${p.cols} 列`}<ChevronDown aria-hidden /></>}>
        <div className="flex flex-col gap-2">
          <SizeInput label="排数" value={p.rows} disabled={p.busy} autoFocus onChange={(r) => p.onResize(r, p.cols)} />
          <SizeInput label="列数" value={p.cols} disabled={p.busy} onChange={(c) => p.onResize(p.rows, c)} />
        </div>
      </Popover>
      <Button type="button" disabled={p.busy || !p.dirty} onClick={p.onSave}>保存座位</Button>
      {p.conflict && <ConflictDialog onReload={p.onReload} onKeepEditing={p.onKeepEditing} />}
    </div>
  )
}
