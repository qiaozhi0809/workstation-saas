import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { timetableApi } from '@/shared/api/timetable'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { ClassAdmin } from '@/shared/types/admin'
import type {
  ClassTimetable,
  Period,
  TimetableCell,
  TimetableCellInput,
} from '@/shared/types/timetable'
import { ALL_DAYS, WEEKDAY_LABEL, WORKDAYS, type Weekday } from './weekdays'

type Slot = { weekday: Weekday; period_no: number }
const sameSlot = (a: Slot, b: Slot) => a.weekday === b.weekday && a.period_no === b.period_no
const slotLabel = (s: Slot) => `${WEEKDAY_LABEL[s.weekday]} 第 ${s.period_no} 节`

/** 未改动的格子原样带回 teacher_id(保留 CSV 导入时指定的老师);没有老师的格子交给后端自动匹配 */
const toInput = (c: TimetableCell): TimetableCellInput => ({
  weekday: c.weekday,
  period_no: c.period_no,
  subject: c.subject,
  teacher_id: c.teacher?.id ?? null,
})

/** 课表里已出现过、且教同一科目的老师:没有"该班该科任课老师 id"的接口,这是前端唯一能拿到的 teachers.id 候选 */
function seenTeachers(cells: TimetableCell[], subject: string): { id: string; name: string }[] {
  const out = new Map<string, string>()
  for (const c of cells)
    if (c.subject === subject && c.teacher) out.set(c.teacher.id, c.teacher.name)
  return [...out].map(([id, name]) => ({ id, name }))
}

function CellEditor({
  slot,
  cell,
  cells,
  cls,
  busy,
  error,
  onSave,
  onClear,
  onClose,
}: {
  slot: Slot
  cell: TimetableCell | undefined
  cells: TimetableCell[]
  cls: ClassAdmin | undefined
  busy: boolean
  error: string
  onSave(subject: string, teacherId: string | null): void
  onClear(): void
  onClose(): void
}) {
  const [subject, setSubject] = useState(cell?.subject ?? '')
  const [teacherId, setTeacherId] = useState(cell?.teacher?.id ?? '')
  // 科目候选 = 组织架构里本班有在任老师的科目 ∪ 课表里已出现的科目
  const subjects = [
    ...new Set([...(cls?.subjects.map((s) => s.subject) ?? []), ...cells.map((c) => c.subject)]),
  ]
  const candidates = seenTeachers(cells, subject)
  if (
    cell?.teacher &&
    cell.subject === subject &&
    !candidates.some((t) => t.id === cell.teacher?.id)
  )
    candidates.unshift(cell.teacher)
  const staff =
    cls?.subjects.find((s) => s.subject === subject)?.teachers.map((t) => t.display_name) ?? []
  const hint = !subject
    ? ''
    : staff.length === 0
      ? `组织架构里还没有本班「${subject}」的在任老师,自动匹配会留空`
      : staff.length === 1
        ? `在任老师:${staff[0]}`
        : `在任老师:${staff.join('、')}(多位时自动匹配会留空)`

  return (
    <Modal
      open
      onClose={onClose}
      title={slotLabel(slot)}
      dismissOnOutside={false}
      className="max-w-sm"
    >
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">科目</span>
          <NativeSelect
            aria-label="科目"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              setTeacherId('')
            }}
          >
            <option value="">请选择</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>
        {subjects.length === 0 && cls && (
          <p className="text-xs text-muted-foreground">
            本班还没有任课老师,先到
            <Link
              to={`/admin/org/classes/${cls.id}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              班级信息
            </Link>
            里添加。
          </p>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">老师</span>
          <NativeSelect
            aria-label="老师"
            value={teacherId}
            disabled={!subject}
            onChange={(e) => setTeacherId(e.target.value)}
          >
            <option value="">自动匹配</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {cell && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              disabled={busy}
              onClick={onClear}
            >
              清空
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !subject}
            onClick={() => onSave(subject, teacherId || null)}
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** 某个班的课表格子:星期 × 节次;点格子改科目与老师,每次改动整班保存 */
export default function ClassTimetableGrid({
  classId,
  periods,
}: {
  classId: string
  periods: Period[]
}) {
  const qc = useQueryClient()
  const tt = useQuery({
    queryKey: ['timetable', classId],
    queryFn: () => timetableApi.classTimetable(classId),
  })
  const cls = useQuery({
    queryKey: ['admin', 'class', classId],
    queryFn: () => adminApi.class(classId),
  })
  const [editing, setEditing] = useState<Slot | null>(null)
  const [weekend, setWeekend] = useState(false)
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: (cells: TimetableCellInput[]) => timetableApi.saveClassTimetable(classId, cells),
    onSuccess: (data: ClassTimetable) => {
      qc.setQueryData(['timetable', classId], data)
      // 教室概况按课表判任课老师能不能看摄像头
      void qc.invalidateQueries({ queryKey: ['classroom', classId] })
      toast('已保存课表')
      setEditing(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败,请重试'),
  })

  if (tt.isPending) return <LoadingState />
  if (tt.isError) {
    return (
      <ErrorState
        title={tt.error instanceof ApiError ? tt.error.message : '课表加载失败,请重试'}
        onRetry={() => void tt.refetch()}
        retrying={tt.isFetching}
      />
    )
  }
  const cells = tt.data.cells
  const hasWeekend = cells.some((c) => c.weekday >= 6)
  const days = hasWeekend || weekend ? ALL_DAYS : WORKDAYS
  const ordered = [...periods].sort((a, b) => a.no - b.no)
  const cellAt = (slot: Slot) => cells.find((c) => sameSlot(c, slot))

  const submit = (slot: Slot, next: TimetableCellInput | null) => {
    setError('')
    const rest = cells.filter((c) => !sameSlot(c, slot)).map(toInput)
    save.mutate(next ? [...rest, next] : rest)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{tt.data.class_name}:点格子安排科目与老师</span>
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={hasWeekend || weekend}
            disabled={hasWeekend}
            onChange={(e) => setWeekend(e.target.checked)}
          />
          显示周六日
        </label>
      </div>
      {/* 375 宽时在这个容器里横向滚动,页面本身不溢出 */}
      <div data-testid="timetable-grid" className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[32rem] table-fixed text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="w-24 px-2 py-2 text-left font-medium">
                节次
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className="px-1 py-2 font-medium">
                  {WEEKDAY_LABEL[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((p) => (
              <tr key={p.no} className="border-t">
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  <div>第 {p.no} 节</div>
                  <div className="text-xs text-muted-foreground">
                    {p.starts_at}–{p.ends_at}
                  </div>
                </th>
                {days.map((d) => {
                  const slot: Slot = { weekday: d, period_no: p.no }
                  const cell = cellAt(slot)
                  return (
                    <td key={d} className="p-1 align-top">
                      <button
                        type="button"
                        data-testid={`timetable-cell-${d}-${p.no}`}
                        aria-label={`${slotLabel(slot)}:${
                          cell ? `${cell.subject} ${cell.teacher?.name ?? '未指定老师'}` : '空'
                        }`}
                        className={cn(
                          'flex min-h-12 w-full flex-col items-center justify-center rounded-md border px-1 py-1 text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          cell
                            ? 'border-transparent bg-primary/10 hover:bg-primary/20'
                            : 'border-dashed text-muted-foreground hover:bg-accent',
                        )}
                        onClick={() => {
                          setError('')
                          setEditing(slot)
                        }}
                      >
                        {cell ? (
                          <>
                            <span className="font-medium">{cell.subject}</span>
                            <span
                              className={cn(
                                'text-xs',
                                cell.teacher ? 'text-muted-foreground' : 'text-warning',
                              )}
                            >
                              {cell.teacher?.name ?? '未指定老师'}
                            </span>
                          </>
                        ) : (
                          <span aria-hidden="true">＋</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <CellEditor
          key={`${editing.weekday}-${editing.period_no}`}
          slot={editing}
          cell={cellAt(editing)}
          cells={cells}
          cls={cls.data}
          busy={save.isPending}
          error={error}
          onSave={(subject, teacherId) =>
            submit(editing, {
              weekday: editing.weekday,
              period_no: editing.period_no,
              subject,
              teacher_id: teacherId,
            })
          }
          onClear={() => submit(editing, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
