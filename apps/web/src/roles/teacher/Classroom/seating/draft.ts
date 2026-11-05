import { inGrid, type DeskGrid } from '@/shared/lib/seats'
import type { SeatingSave } from '@/shared/types/seating'

export interface DraftStudent {
  enrollmentId: string
  name: string
  studentNo: string | null
  gender: 'female' | 'male' | null
  row: number | null
  col: number | null
  locked: boolean
}

export interface Cell {
  row: number
  col: number
}

export interface SeatDraft {
  /** 桌椅排列(只读,来自班级;草稿里不能改) */
  readonly grid: DeskGrid
  baseVersion: number
  students: DraftStudent[]
  past: Pick<SeatDraft, 'students'>[]
  selected: string | null
}

export type DraftAction =
  | { type: 'select'; enrollmentId: string | null }
  | { type: 'moveTo'; enrollmentId: string; to: Cell }
  | { type: 'swapCells'; from: Cell; to: Cell }
  | { type: 'unseat'; enrollmentId: string }
  | { type: 'toggleLock'; enrollmentId: string }
  | { type: 'apply'; students: DraftStudent[] }
  | { type: 'undo' }
  | { type: 'reset'; draft: SeatDraft }

const MAX_PAST = 30

export function initDraft(input: {
  grid: DeskGrid
  baseVersion: number
  students: DraftStudent[]
}): SeatDraft {
  return { ...input, past: [], selected: null }
}

export function occupantAt(draft: SeatDraft, cell: Cell): DraftStudent | undefined {
  return draft.students.find((s) => s.row === cell.row && s.col === cell.col)
}

function commit(state: SeatDraft, next: Pick<SeatDraft, 'students'>): SeatDraft {
  const snapshot = { students: state.students }
  return { ...state, ...next, past: [...state.past, snapshot].slice(-MAX_PAST), selected: null }
}

function moveTo(state: SeatDraft, enrollmentId: string, to: Cell): SeatDraft {
  const mover = state.students.find((s) => s.enrollmentId === enrollmentId)
  if (!mover || mover.locked) return state
  if (!inGrid(state.grid, to)) return state
  if (mover.row === to.row && mover.col === to.col) return state
  const other = occupantAt(state, to)
  if (other?.locked) return state
  const students = state.students.map((s) => {
    if (s.enrollmentId === mover.enrollmentId) return { ...s, row: to.row, col: to.col }
    if (other && s.enrollmentId === other.enrollmentId)
      return { ...s, row: mover.row, col: mover.col }
    return s
  })
  return commit(state, { students })
}

export function draftReducer(state: SeatDraft, action: DraftAction): SeatDraft {
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.enrollmentId }
    case 'moveTo':
      return moveTo(state, action.enrollmentId, action.to)
    case 'swapCells': {
      const from = occupantAt(state, action.from)
      return from ? moveTo(state, from.enrollmentId, action.to) : state
    }
    case 'unseat': {
      const target = state.students.find((s) => s.enrollmentId === action.enrollmentId)
      if (!target || target.locked || target.row === null) return state
      return commit(state, {
        students: state.students.map((s) =>
          s.enrollmentId === target.enrollmentId ? { ...s, row: null, col: null } : s,
        ),
      })
    }
    case 'toggleLock': {
      const target = state.students.find((s) => s.enrollmentId === action.enrollmentId)
      if (!target || target.row === null) return state
      return commit(state, {
        students: state.students.map((s) =>
          s.enrollmentId === target.enrollmentId ? { ...s, locked: !s.locked } : s,
        ),
      })
    }
    case 'apply':
      return commit(state, { students: action.students })
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return { ...state, ...previous, past: state.past.slice(0, -1), selected: null }
    }
    case 'reset':
      return action.draft
  }
}

const seatKey = (s: DraftStudent) => `${s.enrollmentId}|${s.row}|${s.col}|${s.locked}`

export function isDirty(draft: SeatDraft, original: SeatDraft): boolean {
  if (draft.students.length !== original.students.length) return true
  const before = new Set(original.students.map(seatKey))
  return draft.students.some((s) => !before.has(seatKey(s)))
}

export function toSavePayload(draft: SeatDraft): SeatingSave {
  const seats = draft.students
    .filter(
      (s): s is DraftStudent & { row: number; col: number } => s.row !== null && s.col !== null,
    )
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((s) => ({ enrollment_id: s.enrollmentId, row: s.row, col: s.col, locked: s.locked }))
  return { base_version: draft.baseVersion, rows: draft.grid.rows, cols: draft.grid.cols, seats }
}
