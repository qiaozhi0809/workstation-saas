import { useState } from 'react'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import { toolButton } from '../Toolbar'
import type { DraftStudent } from './draft'

const MIN_SIZE = 1
const MAX_SIZE = 12
const primaryButton =
  'rounded-lg bg-ink px-3 py-1 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
// 隐藏浏览器自带的上下箭头:它们逐次触发 change,改由两侧的步进按钮提交
const sizeInput = 'w-12 rounded-lg border border-line-2 bg-panel px-2 py-1 text-center [appearance:textfield] '
  + '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none '
  + 'aria-[invalid=true]:border-red'
const stepButton = 'h-7 w-7 rounded-lg border border-line-2 text-sm disabled:cursor-not-allowed disabled:opacity-40'

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
function SizeInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange(n: number): void }) {
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
      <button type="button" className={stepButton} aria-label={`减少${label}`} disabled={disabled || value <= MIN_SIZE}
        onClick={() => apply(value - 1)}>−</button>
      <input id={`seat-size-${label}`} type="number" className={sizeInput} min={MIN_SIZE} max={MAX_SIZE}
        value={text ?? value} disabled={disabled} aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            apply(value + (e.key === 'ArrowUp' ? 1 : -1))
          }
        }} />
      <button type="button" className={stepButton} aria-label={`增加${label}`} disabled={disabled || value >= MAX_SIZE}
        onClick={() => apply(value + 1)}>+</button>
    </div>
  )
}

function ConflictDialog({ onReload, onKeepEditing }: Pick<SeatingBarProps, 'onReload' | 'onKeepEditing'>) {
  useEscapeLayer(true, onKeepEditing)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div role="dialog" aria-modal="true" aria-labelledby="seating-conflict-title"
        className="flex w-[400px] max-w-[92vw] flex-col gap-3 rounded-2xl bg-panel p-5 shadow-xl">
        <h3 id="seating-conflict-title" className="text-lg font-semibold">座位表已被其他人修改</h3>
        <p className="text-sm text-ink-2">你的修改还没有保存。可以放弃修改并载入最新的座位表,也可以继续编辑。</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={toolButton} onClick={onReload}>放弃我的修改并重新加载</button>
          {/* 对话框打开时焦点落在不丢数据的选项上 */}
          <button type="button" className={primaryButton} autoFocus onClick={onKeepEditing}>继续编辑</button>
        </div>
      </div>
    </div>
  )
}

/** 排座操作条:整体编排、撤销 / 放弃、行列、固定、打印、保存。 */
export default function SeatingBar(p: SeatingBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className={toolButton} disabled={p.busy} onClick={p.onShuffle}>随机打乱</button>
      <button type="button" className={toolButton} disabled={p.busy} onClick={p.onPair}>男女同桌</button>
      <button type="button" className={toolButton} disabled={p.busy || !p.canUndo} onClick={p.onUndo}>撤销</button>
      <button type="button" className={toolButton} disabled={p.busy || !p.dirty} onClick={p.onDiscard}>放弃修改</button>
      <SizeInput label="排数" value={p.rows} disabled={p.busy} onChange={(r) => p.onResize(r, p.cols)} />
      <SizeInput label="列数" value={p.cols} disabled={p.busy} onChange={(c) => p.onResize(p.rows, c)} />
      <button type="button" className={toolButton} disabled={p.busy || !p.selected} onClick={p.onToggleLock}>
        {p.selected?.locked ? '取消固定' : '固定座位'}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={toolButton} onClick={p.onPrint}>打印</button>
        <button type="button" className={primaryButton} disabled={p.busy || !p.dirty} onClick={p.onSave}>保存座位</button>
      </div>
      {p.conflict && <ConflictDialog onReload={p.onReload} onKeepEditing={p.onKeepEditing} />}
    </div>
  )
}
