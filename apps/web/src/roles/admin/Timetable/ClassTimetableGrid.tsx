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
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
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

/**
 * 老师候选(L209):该班该科的在任老师优先(组织架构 StaffBrief 带 teachers.id 即 teacher_id),
 * 其次课表里已出现过、教同一科目但已不在任的老师;同一人只列一次
 */
function teacherCandidates(
  cls: ClassAdmin | undefined,
  cells: TimetableCell[],
  subject: string,
): { id: string; name: string }[] {
  const out = new Map<string, string>()
  for (const t of cls?.subjects.find((s) => s.subject === subject)?.teachers ?? [])
    out.set(t.teacher_id, t.display_name)
  for (const c of cells)
    if (c.subject === subject && c.teacher && !out.has(c.teacher.id))
      out.set(c.teacher.id, c.teacher.name)
  return [...out].map(([id, name]) => ({ id, name }))
}

function CellEditor({
  slot,
  cell,
  cells,
  cls,
  clsError,
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
  clsError: boolean
  busy: boolean
  error: string
  onSave(subject: string, teacherId: string | null): void
  onClear(): void
  onClose(): void
}) {
  const [subject, setSubject] = useState(cell?.subject ?? '')
  const [teacherId, setTeacherId] = useState(cell?.teacher?.id ?? '')
  const { errors, report, clear, fieldRef } = useFormErrors(['subject'] as const)
  // 科目候选 = 组织架构里本班有在任老师的科目 ∪ 课表里已出现的科目
  const subjects = [
    ...new Set([...(cls?.subjects.map((s) => s.subject) ?? []), ...cells.map((c) => c.subject)]),
  ]
  // 当前格子的老师本来就在 cells 里,所以一定已在候选中
  const candidates = teacherCandidates(cls, cells, subject)
  // 在任老师提示只在组织架构数据到手后给;还在加载 / 失败时不猜
  const staff =
    cls?.subjects.find((s) => s.subject === subject)?.teachers.map((t) => t.display_name) ?? []
  const hint =
    !subject || !cls
      ? ''
      : staff.length === 0
        ? `组织架构里还没有本班「${subject}」的在任老师,自动匹配会留空`
        : staff.length === 1
          ? `在任老师:${staff[0]}`
          : `在任老师:${staff.join('、')}(多位时自动匹配会留空)`

  const submit = () => {
    if (!report(subject ? {} : { subject: '请选择科目' })) return
    onSave(subject, teacherId || null)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={slotLabel(slot)}
      dismissOnOutside={false}
      className="max-w-sm"
    >
      <div className="space-y-3">
        <Field label="科目" error={errors.subject}>
          <NativeSelect
            ref={fieldRef('subject')}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              setTeacherId('')
              clear('subject')
            }}
          >
            <option value="">请选择</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </Field>
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
        <Field label="老师">
          <NativeSelect
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
        </Field>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {clsError && (
          <p className="text-xs text-destructive">
            班级信息加载失败,看不到在任老师;科目与老师仍可按课表里已有的选择。
          </p>
        )}
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
          <Button type="button" disabled={busy} onClick={submit}>
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

  if (tt.isPending) return <LoadingState variant="table" />
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
        <Checkbox
          label="显示周六日"
          className="ml-auto"
          checked={hasWeekend || weekend}
          disabled={hasWeekend}
          onChange={(e) => setWeekend(e.target.checked)}
        />
      </div>
      {/* 375 宽时在 Table 的滚动容器里横向滚动,页面本身不溢出 */}
      <div data-testid="timetable-grid">
        <Table
          minWidth={720}
          containerClassName="rounded-none bg-transparent shadow-none"
          className="w-full table-fixed"
        >
          <TableHead>
            <TableRow>
              <Th className="w-24">节次</Th>
              {days.map((d) => (
                <Th key={d}>{WEEKDAY_LABEL[d]}</Th>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((p) => (
              <TableRow key={p.no}>
                <Th
                  scope="row"
                  nowrap={false}
                  className="h-auto py-1 text-sm font-normal text-foreground"
                >
                  <div>第 {p.no} 节</div>
                  <div className="text-xs text-muted-foreground">
                    {p.starts_at}–{p.ends_at}
                  </div>
                </Th>
                {days.map((d) => {
                  const slot: Slot = { weekday: d, period_no: p.no }
                  const cell = cellAt(slot)
                  return (
                    <Td key={d} className="p-1 align-top">
                      <button
                        type="button"
                        data-testid={`timetable-cell-${d}-${p.no}`}
                        aria-label={`${slotLabel(slot)}:${
                          cell ? `${cell.subject} ${cell.teacher?.name ?? '未指定老师'}` : '空'
                        }`}
                        className={cn(
                          'flex h-12 w-full min-w-0 flex-col items-center justify-center rounded-md border px-1 py-1 text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
                            <span className="max-w-full truncate font-medium">{cell.subject}</span>
                            <span
                              className={cn(
                                'max-w-full truncate text-xs',
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
                    </Td>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <CellEditor
          key={`${editing.weekday}-${editing.period_no}`}
          slot={editing}
          cell={cellAt(editing)}
          cells={cells}
          cls={cls.data}
          clsError={cls.isError}
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
