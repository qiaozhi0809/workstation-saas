import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { seatingApi } from '@/shared/api/seating'
import { genderOf } from '@/shared/components/ClassroomMap/art/StudentFigure'
import type { Cell, SeatView } from '@/shared/components/ClassroomMap/types'
import { toast } from '@/shared/components/Toast'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import type { ClassroomSummary } from '@/shared/types/classroom'
import type { StudentSeat } from '@/shared/types/student'
import { genderPairSeats, shuffleSeats } from './algorithms'
import { draftReducer, initDraft, isDirty, toSavePayload, type DraftAction, type SeatDraft } from './draft'
import { printSeating, seatingPrintHtml } from './printSeating'
import type { SeatingBarProps } from './SeatingBar'
import type { UnseatedTrayProps } from './UnseatedTray'

interface Options {
  classId: string
  className: string
  enabled: boolean
}

/** 草稿、它的起点,以及建草稿时用的名单(地图上的学生信息取自它,和草稿始终一致) */
interface Drafts { draft: SeatDraft; original: SeatDraft; roster: StudentSeat[] }
/** loading:正在取最新数据建草稿;failed:取数失败,排座不可编辑 */
type Status = 'idle' | 'loading' | 'failed'

const LOAD_FAILED = '座位表加载失败,请重试'

/** 用名单 + 行列 + 版本建草稿;不在格内的座位视为未排座。 */
function buildDraft(roster: StudentSeat[], rows: number, cols: number, baseVersion: number): SeatDraft {
  return initDraft({
    rows, cols, baseVersion,
    students: roster.map((s) => {
      const seated = s.seat_row !== null && s.seat_col !== null
        && s.seat_row >= 1 && s.seat_row <= rows && s.seat_col >= 1 && s.seat_col <= cols
      return {
        enrollmentId: s.enrollment_id,
        name: s.name,
        gender: genderOf(s.gender),
        row: seated ? s.seat_row : null,
        col: seated ? s.seat_col : null,
        locked: seated && s.seat_locked,
      }
    }),
  })
}

/**
 * 排座模式。草稿只在进入模式、保存成功后、重新加载时重建,而且每次都先向服务端取最新数据:
 * 先取概况(版本号),再取名单与班级行列。这样版本号只可能比座位数据旧(最多误报一次冲突),
 * 不会比座位数据新(那会覆盖别人的修改)。后台定时刷新不会冲掉老师正在编辑的草稿。
 */
export function useSeatingMode(o: Options) {
  const { classId, enabled } = o
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  // 同步守卫:第二次点击发生在按钮禁用前也不会再发请求
  const inflight = useRef(false)
  // 每次加载一个序号:离开模式或开始新的加载后,旧加载的结果作废
  const seq = useRef(0)

  // 离开模式:丢弃草稿与弹窗
  if (!enabled && (drafts || status !== 'idle' || conflict)) {
    setDrafts(null)
    setStatus('idle')
    setConflict(false)
  }

  /** 取最新数据并重建草稿;minVersion 为保存成功时服务端返回的版本。失败则不建草稿。 */
  const load = useCallback(async (minVersion = 0) => {
    const token = ++seq.current
    setStatus('loading')
    // 先取消进行中的旧请求(包括首次加载),保证新请求在上一步之后才发出
    const fresh = async (queryKey: QueryKey) => {
      await qc.cancelQueries({ queryKey })
      await qc.invalidateQueries({ queryKey, refetchType: 'all' }, { throwOnError: true })
    }
    try {
      await fresh(['classroom', classId])
      const summary = qc.getQueryData<ClassroomSummary>(['classroom', classId])
      await Promise.all([fresh(['class-students', classId]), fresh(['my-classes'])])
      const roster = qc.getQueryData<{ items: StudentSeat[] }>(['class-students', classId])?.items
      const cls = qc.getQueryData<{ items: ClassView[] }>(['my-classes'])?.items.find((c) => c.id === classId)
      if (!summary || !roster || !cls) throw new Error(LOAD_FAILED)
      if (token !== seq.current) return
      const d = buildDraft(roster, cls.seat_rows, cls.seat_cols, Math.max(summary.seat_version, minVersion))
      setDrafts({ draft: d, original: d, roster })
      setStatus('idle')
    } catch {
      if (token !== seq.current) return
      toast(LOAD_FAILED)
      setDrafts(null)
      setStatus('failed')
    }
  }, [qc, classId])

  // 离开模式(或卸载)时让进行中的加载作废
  const abandonLoads = useCallback(() => { seq.current++ }, [])
  useEffect(() => {
    if (!enabled) return
    void load()
    return abandonLoads
  }, [enabled, load, abandonLoads])

  const draft = drafts?.draft ?? null
  const dirty = !!drafts && isDirty(drafts.draft, drafts.original)
  // 保存或加载进行中:草稿不可编辑(否则改动会被随后的重建悄悄丢掉)
  const busy = saving || status === 'loading'

  const setSeatingDirty = useTeacherStore((s) => s.setSeatingDirty)
  useEffect(() => { setSeatingDirty(dirty) }, [dirty, setSeatingDirty])
  useEffect(() => () => setSeatingDirty(false), [setSeatingDirty])

  const update = useCallback((f: (d: SeatDraft) => SeatDraft) => setDrafts((cur) => {
    if (!cur) return cur
    const next = f(cur.draft)
    return next === cur.draft ? cur : { ...cur, draft: next }
  }), [])
  const dispatch = useCallback((a: DraftAction) => update((d) => draftReducer(d, a)), [update])

  /** 点学生:未选中 → 选中;再点自己 → 取消;已选别人 → 换到该生的位置(换不了就改选该生)。 */
  const clickStudent = useCallback((id: string) => update((d) => {
    if (d.selected === id) return draftReducer(d, { type: 'select', enrollmentId: null })
    const target = d.students.find((s) => s.enrollmentId === id)
    if (d.selected && target && target.row !== null && target.col !== null) {
      const moved = draftReducer(d, { type: 'moveTo', enrollmentId: d.selected, to: { row: target.row, col: target.col } })
      if (moved !== d) return moved
    }
    return draftReducer(d, { type: 'select', enrollmentId: id })
  }), [update])

  const clickEmpty = useCallback((cell: Cell) => update((d) =>
    (d.selected ? draftReducer(d, { type: 'moveTo', enrollmentId: d.selected, to: cell }) : d)), [update])
  const drop = useCallback((from: Cell, to: Cell) => dispatch({ type: 'swapCells', from, to }), [dispatch])

  const save = async () => {
    if (!drafts || !dirty || busy || inflight.current) return
    inflight.current = true
    setSaving(true)
    try {
      const res = await seatingApi.save(classId, toSavePayload(drafts.draft))
      toast('座位已保存')
      await load(res.version)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SEAT_VERSION_CONFLICT') setConflict(true)
      else if (err instanceof ApiError && err.code === 'SEAT_INVALID') {
        toast('学生名单有变化,已重新加载')
        await load()
      } else toast(err instanceof Error ? err.message : '保存失败')
    } finally {
      inflight.current = false
      setSaving(false)
    }
  }

  // 地图:草稿位置覆盖名单位置,未排座的不上图
  const seats = useMemo(() => {
    if (!drafts) return undefined
    const byId = new Map(drafts.draft.students.map((s) => [s.enrollmentId, s]))
    return drafts.roster.flatMap((s) => {
      const d = byId.get(s.enrollment_id)
      return d && d.row !== null && d.col !== null
        ? [{ ...s, seat_row: d.row, seat_col: d.col, seat_locked: d.locked }]
        : []
    })
  }, [drafts])

  const views = useMemo(() => {
    const out: Record<string, SeatView> = {}
    for (const s of draft?.students ?? []) {
      if (s.locked || s.enrollmentId === draft?.selected) {
        out[s.enrollmentId] = { ...(s.locked ? { locked: true } : {}), ...(s.enrollmentId === draft?.selected ? { selected: true } : {}) }
      }
    }
    return out
  }, [draft])

  if (!enabled || !drafts || !draft) {
    return { ready: false as const, dirty, failed: status === 'failed', retry: () => void load() }
  }

  const selected = draft.students.find((s) => s.enrollmentId === draft.selected) ?? null
  const selectedSeated = selected && selected.row !== null ? selected : null

  const bar: SeatingBarProps = {
    rows: draft.rows,
    cols: draft.cols,
    canUndo: draft.past.length > 0,
    dirty,
    busy,
    selected: selectedSeated,
    conflict,
    onShuffle: () => dispatch({ type: 'apply', students: shuffleSeats(draft.students, draft.rows, draft.cols, Math.random) }),
    onPair: () => dispatch({ type: 'apply', students: genderPairSeats(draft.students, draft.rows, draft.cols, Math.random) }),
    onUndo: () => dispatch({ type: 'undo' }),
    onDiscard: () => dispatch({ type: 'reset', draft: drafts.original }),
    onResize: (r, c) => dispatch({ type: 'resize', rows: r, cols: c }),
    onToggleLock: () => { if (selectedSeated) dispatch({ type: 'toggleLock', enrollmentId: selectedSeated.enrollmentId }) },
    onPrint: () => printSeating(seatingPrintHtml({ className: o.className, rows: draft.rows, cols: draft.cols, students: draft.students })),
    onSave: () => void save(),
    onReload: () => { setConflict(false); void load() },
    onKeepEditing: () => setConflict(false),
  }
  const tray: UnseatedTrayProps = {
    students: draft.students.filter((s) => s.row === null),
    selectedId: draft.selected,
    canUnseat: !!selectedSeated && !selectedSeated.locked,
    busy,
    seedOf: (id) => {
      const s = drafts.roster.find((r) => r.enrollment_id === id)
      return s ? s.avatar_seed ?? s.student_id : id
    },
    onSelect: clickStudent,
    onUnseat: () => { if (selectedSeated) dispatch({ type: 'unseat', enrollmentId: selectedSeated.enrollmentId }) },
  }

  return {
    ready: true as const,
    dirty,
    seats: seats ?? [],
    rows: draft.rows,
    cols: draft.cols,
    views,
    // 保存 / 加载期间地图不可编辑
    onSeatClick: busy ? undefined : (seat: StudentSeat) => clickStudent(seat.enrollment_id),
    onEmptySeatClick: busy ? undefined : clickEmpty,
    onSeatDrop: busy ? undefined : drop,
    bar,
    tray,
  }
}
