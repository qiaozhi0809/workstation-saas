import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { seatingApi } from '@/shared/api/seating'
import { studentsApi } from '@/shared/api/students'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import { DESK_TYPES, colRange } from '@/shared/lib/seats'
import type { ClassView } from '@/shared/types/class'
import type { DeskSize, LayoutDraft, LayoutHow, LayoutSaved, SeatLayoutMode } from '@/shared/types/seating'
import { SeatPreview } from './SeatPreview'
import { useLayoutPreview } from './useLayoutPreview'


export interface ClassSettingsDialogProps {
  cls: ClassView
  seatVersion: number
  studentCount: number
  hasSeated: boolean
  onClose(): void
  onSaved(result: LayoutSaved): void
  onGo(to: 'add' | 'import' | 'list'): void
}

const MAX_ROWS = 12
const MAX_PODIUM = 2
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** 某桌型每排桌数范围(colRange 是座位数范围) */
const deskRange = (desk: DeskSize): [number, number] => {
  const [lo, hi] = colRange(desk)
  return [Math.ceil(lo / desk), Math.floor(hi / desk)]
}

const HOW_OPTIONS: { value: LayoutHow; label: string }[] = [
  { value: 'keep', label: '保持现在的座位' },
  { value: 'row', label: '按学号横着排' },
  { value: 'col', label: '按学号一组一组竖着排' },
]
const howNote = (how: LayoutHow, desk: DeskSize) => {
  if (how === 'keep') return '已经坐好的同学位置不变;桌椅变少时坐不下的同学、还没座位的同学,按顺序坐到空位上'
  if (how === 'row') return '横着排:1 号坐第一排最左边,往右依次坐,坐满一排再坐下一排'
  return desk === 1 ? '竖着排:先坐满第一列,从前往后,再坐下一列' : '竖着排:先坐满第一组,从前往后,再坐下一组'
}

function Stepper(p: { label: string; unit: string; value: number; min: number; max: number; onChange(n: number): void }) {
  return (
    <div role="group" aria-label={p.label} className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0">{p.label}</span>
      <Button type="button" variant="outline" size="icon" aria-label={`${p.label}减少`} disabled={p.value <= p.min} onClick={() => p.onChange(p.value - 1)}>−</Button>
      <span className="w-6 text-center tabular-nums">{p.value}</span>
      <Button type="button" variant="outline" size="icon" aria-label={`${p.label}增加`} disabled={p.value >= p.max} onClick={() => p.onChange(p.value + 1)}>+</Button>
      <span>{p.unit}</span>
    </div>
  )
}

export default function ClassSettingsDialog({ cls, seatVersion, studentCount, hasSeated, onClose, onSaved, onGo }: ClassSettingsDialogProps) {
  const [room, setRoom] = useState(cls.room)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<LayoutDraft>({
    desk_size: cls.desk_size, seat_layout: cls.seat_layout, rows: cls.seat_rows, cols: cls.seat_cols,
    podium_left: cls.podium_left, podium_right: cls.podium_right, how: hasSeated ? 'keep' : cls.seat_order,
  })
  const preview = useLayoutPreview(cls.id, draft)
  const roster = useQuery({ queryKey: ['class-students', cls.id], queryFn: () => studentsApi.listInClass(cls.id) })
  const names = Object.fromEntries((roster.data?.items ?? []).map((s) => [s.enrollment_id, s.name]))
  const patch = (p: Partial<LayoutDraft>) => setDraft((d) => ({ ...d, ...p }))
  const manual = draft.seat_layout === 'manual'

  const setDesk = (desk: DeskSize) => {
    if (!manual) return patch({ desk_size: desk, cols: null })
    const current = draft.cols ?? preview.data?.cols ?? cls.seat_cols
    const [lo, hi] = deskRange(desk)
    patch({ desk_size: desk, cols: clamp(Math.round(current / desk), lo, hi) * desk })
  }
  const setLayout = (mode: SeatLayoutMode) => {
    if (mode === 'manual') patch({ seat_layout: mode, rows: preview.data?.rows ?? draft.rows, cols: preview.data?.cols ?? draft.cols })
    else patch({ seat_layout: mode, cols: preview.data?.cols ?? draft.cols })
  }

  const save = async (then?: () => void) => {
    setBusy(true)
    try {
      const result = await seatingApi.saveLayout(cls.id, { ...draft, base_version: seatVersion, room })
      toast(result.moved ? '已保存,座位已按新桌椅排好' : '已保存')
      onSaved(result)
      onClose()
      then?.()
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? '座位表已被其他人修改,请关闭后重新打开' : '保存失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  const pv = preview.data
  const podiumSeats = draft.podium_left + draft.podium_right
  const [deskLo, deskHi] = deskRange(draft.desk_size)

  return (
    <Modal open onClose={onClose} title={`班级设置 · ${cls.name}`} dismissOnOutside={false} className="max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm font-medium">班级名称</div>
            <div className="text-sm">{cls.name}</div>
            <p className="text-xs text-muted-foreground">班级名称由学校统一管理</p>
          </div>
          <label className="space-y-1 text-sm font-medium">
            教室
            <Input aria-label="教室" maxLength={30} placeholder="如:博学楼 301" value={room} onChange={(e) => setRoom(e.target.value)} />
          </label>
        </div>

        <h3 className="text-sm font-semibold">桌椅排列</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm">每张桌子</div>
              <SegmentedTabs label="每张桌子" items={DESK_TYPES.map((d) => ({ value: String(d.n), label: d.label }))}
                value={String(draft.desk_size)} onChange={(v) => setDesk(Number(v) as DeskSize)} />
            </div>
            <div className="space-y-2">
              <div className="text-sm">行列</div>
              <SegmentedTabs label="行列" items={[{ value: 'auto', label: '按人数自动排' }, { value: 'manual', label: '自己设定' }]}
                value={draft.seat_layout} onChange={(v) => setLayout(v as SeatLayoutMode)} />
              {manual && (
                <div className="space-y-2">
                  <Stepper label="排数" unit="排" value={draft.rows} min={1} max={MAX_ROWS} onChange={(n) => patch({ rows: n })} />
                  <Stepper label="每排" unit="张桌子" value={Math.round((draft.cols ?? cls.seat_cols) / draft.desk_size)}
                    min={deskLo} max={deskHi} onChange={(n) => patch({ cols: n * draft.desk_size })} />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-sm">讲台两边</div>
              <Stepper label="左边" unit="张" value={draft.podium_left} min={0} max={MAX_PODIUM} onChange={(n) => patch({ podium_left: n })} />
              <Stepper label="右边" unit="张" value={draft.podium_right} min={0} max={MAX_PODIUM} onChange={(n) => patch({ podium_right: n })} />
              <p className="text-xs text-muted-foreground">默认不放。加好后在「排座」模式里把同学拖过去;重新排座、随机打乱时,坐在这里的同学不动</p>
            </div>
            <div className="space-y-2">
              <div className="text-sm">学生坐哪儿</div>
              <div className="flex flex-wrap gap-2">
                {HOW_OPTIONS.map((o) => (
                  <Button key={o.value} type="button" size="sm" variant={draft.how === o.value ? 'default' : 'outline'}
                    aria-pressed={draft.how === o.value} onClick={() => patch({ how: o.value })}>{o.label}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{howNote(draft.how, draft.desk_size)}</p>
            </div>
          </div>

          <div className="space-y-2">
            {pv && <SeatPreview draft={draft} preview={pv} names={names} />}
            {pv && (
              <p className="text-sm">
                {`${pv.rows} 排 × ${pv.cols} 个座位${podiumSeats > 0 ? ` + 讲台边 ${podiumSeats} 个` : ''} = ${pv.capacity} 个座位 · 学生 ${pv.students} 人`}
              </p>
            )}
            {pv && (pv.capacity < pv.students ? (
              <p className="text-sm text-destructive">{`座位比学生少 ${pv.students - pv.capacity} 个,坐不下的同学会显示为「未排座」`}</p>
            ) : pv.unseated > 0 ? (
              <p className="text-sm text-muted-foreground">{`${pv.unseated} 人未排座,可以在「排座」模式里拖到空位`}</p>
            ) : null)}
            {preview.isError && <p role="alert" className="text-sm text-destructive">预览加载失败</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="font-medium">{`学生人数 ${studentCount} 人`}</span>
          <span className="text-xs text-muted-foreground">
            {draft.seat_layout === 'auto' ? '人数跟着名单走,加减学生座位会自动调整' : '人数跟着名单走;座位不够时,多出来的同学显示为「未排座」'}
          </span>
          <span className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save(() => onGo('add'))}>添加学生</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save(() => onGo('import'))}>批量导入</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save(() => onGo('list'))}>管理名单</Button>
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
