import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { seatingApi } from '@/shared/api/seating'
import { genderOf } from '@/shared/components/ClassroomMap/art/StudentFigure'
import type { Cell, SeatView } from '@/shared/components/ClassroomMap/types'
import { toast } from '@/shared/components/Toast'
import { useTeacherStore } from '@/shared/stores/teacher'
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
  roster: StudentSeat[] | undefined
  /** 班级当前的行列(来自 my-classes) */
  rows: number
  cols: number
  /** summary.seat_version;概况未加载时为 undefined */
  seatVersion: number | undefined
}

interface Drafts { draft: SeatDraft; original: SeatDraft }
/** 待重建草稿;version 给出时以它为基准版本(保存成功后用返回的版本) */
interface Rebuild { version?: number }

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
 * 排座模式:草稿只在进入模式、保存成功后、重新加载时用最新数据重建,
 * 后台定时刷新名单 / 概况不会冲掉老师正在编辑的草稿。
 */
export function useSeatingMode(o: Options) {
  const { classId, enabled, roster, rows, cols, seatVersion } = o
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  const [rebuild, setRebuild] = useState<Rebuild | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  // 同步守卫:第二次点击发生在按钮禁用前也不会再发请求
  const inflight = useRef(false)

  // 渲染期派生状态:离开模式丢弃草稿;进入模式或请求重建时用当前数据建草稿
  if (!enabled && (drafts || rebuild || conflict)) {
    setDrafts(null)
    setRebuild(null)
    setConflict(false)
  } else if (enabled && roster && seatVersion !== undefined && (!drafts || rebuild)) {
    const d = buildDraft(roster, rows, cols, rebuild?.version ?? seatVersion)
    setDrafts({ draft: d, original: d })
    setRebuild(null)
  }

  const draft = drafts?.draft ?? null
  const dirty = !!drafts && isDirty(drafts.draft, drafts.original)

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

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['class-students', classId] }),
    qc.invalidateQueries({ queryKey: ['classroom', classId] }),
    qc.invalidateQueries({ queryKey: ['my-classes'] }),
  ])

  /** 丢掉草稿,取最新的名单 / 版本 / 行列后重建。 */
  const reload = async () => {
    setBusy(true)
    try {
      await refresh()
      setRebuild({})
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!drafts || !dirty || inflight.current) return
    inflight.current = true
    setBusy(true)
    try {
      const res = await seatingApi.save(classId, toSavePayload(drafts.draft))
      toast('座位已保存')
      await refresh()
      setRebuild({ version: res.version })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SEAT_VERSION_CONFLICT') setConflict(true)
      else if (err instanceof ApiError && err.code === 'SEAT_INVALID') {
        toast('学生名单有变化,已重新加载')
        await refresh()
        setRebuild({})
      } else toast(err instanceof Error ? err.message : '保存失败')
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }

  // 地图:草稿位置覆盖名单位置,未排座的不上图
  const seats = useMemo(() => {
    if (!draft || !roster) return undefined
    const byId = new Map(draft.students.map((s) => [s.enrollmentId, s]))
    return roster.flatMap((s) => {
      const d = byId.get(s.enrollment_id)
      return d && d.row !== null && d.col !== null
        ? [{ ...s, seat_row: d.row, seat_col: d.col, seat_locked: d.locked }]
        : []
    })
  }, [draft, roster])

  const views = useMemo(() => {
    const out: Record<string, SeatView> = {}
    for (const s of draft?.students ?? []) {
      if (s.locked || s.enrollmentId === draft?.selected) {
        out[s.enrollmentId] = { ...(s.locked ? { locked: true } : {}), ...(s.enrollmentId === draft?.selected ? { selected: true } : {}) }
      }
    }
    return out
  }, [draft])

  if (!enabled || !drafts || !draft) return { ready: false as const, dirty }

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
    onReload: () => { setConflict(false); void reload() },
    onKeepEditing: () => setConflict(false),
  }
  const tray: UnseatedTrayProps = {
    students: draft.students.filter((s) => s.row === null),
    selectedId: draft.selected,
    canUnseat: !!selectedSeated && !selectedSeated.locked,
    seedOf: (id) => {
      const s = roster?.find((r) => r.enrollment_id === id)
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
    onSeatClick: (seat: StudentSeat) => clickStudent(seat.enrollment_id),
    onEmptySeatClick: clickEmpty,
    onSeatDrop: drop,
    bar,
    tray,
  }
}
