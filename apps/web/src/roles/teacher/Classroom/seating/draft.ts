import type { SeatingSave } from '@/shared/types/seating'

export interface DraftStudent {
  enrollmentId: string
  name: string
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
  rows: number
  cols: number
  baseVersion: number
  students: DraftStudent[]
  past: Pick<SeatDraft, 'rows' | 'cols' | 'students'>[]
  selected: string | null
}

export type DraftAction =
  | { type: 'select'; enrollmentId: string | null }
  | { type: 'moveTo'; enrollmentId: string; to: Cell }
  | { type: 'swapCells'; from: Cell; to: Cell }
  | { type: 'unseat'; enrollmentId: string }
  | { type: 'toggleLock'; enrollmentId: string }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'apply'; students: DraftStudent[] }
  | { type: 'undo' }
  | { type: 'reset'; draft: SeatDraft }

const MAX_PAST = 30
const MIN_SIZE = 1
const MAX_SIZE = 12

export function initDraft(input: {
  rows: number
  cols: number
  baseVersion: number
  students: DraftStudent[]
}): SeatDraft {
  return { ...input, past: [], selected: null }
}

export function occupantAt(draft: SeatDraft, cell: Cell): DraftStudent | undefined {
  return draft.students.find((s) => s.row === cell.row && s.col === cell.col)
}

function commit(state: SeatDraft, next: Partial<Pick<SeatDraft, 'rows' | 'cols' | 'students'>>): SeatDraft {
  const snapshot = { rows: state.rows, cols: state.cols, students: state.students }
  return { ...state, ...next, past: [...state.past, snapshot].slice(-MAX_PAST), selected: null }
}

const clamp = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)))

function moveTo(state: SeatDraft, enrollmentId: string, to: Cell): SeatDraft {
  const mover = state.students.find((s) => s.enrollmentId === enrollmentId)
  if (!mover || mover.locked) return state
  if (to.row < 1 || to.row > state.rows || to.col < 1 || to.col > state.cols) return state
  if (mover.row === to.row && mover.col === to.col) return state
  const other = occupantAt(state, to)
  if (other?.locked) return state
  const students = state.students.map((s) => {
    if (s.enrollmentId === mover.enrollmentId) return { ...s, row: to.row, col: to.col }
    if (other && s.enrollmentId === other.enrollmentId) return { ...s, row: mover.row, col: mover.col }
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
    case 'resize': {
      const rows = clamp(action.rows)
      const cols = clamp(action.cols)
      const outside = (s: DraftStudent) =>
        s.row !== null && s.col !== null && (s.row > rows || s.col > cols)
      if (rows === state.rows && cols === state.cols && !state.students.some(outside)) return state
      return commit(state, {
        rows,
        cols,
        students: state.students.map((s) =>
          outside(s) ? { ...s, row: null, col: null, locked: false } : s,
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
  if (draft.rows !== original.rows || draft.cols !== original.cols) return true
  if (draft.students.length !== original.students.length) return true
  const before = new Set(original.students.map(seatKey))
  return draft.students.some((s) => !before.has(seatKey(s)))
}

export function toSavePayload(draft: SeatDraft): SeatingSave {
  const seats = draft.students
    .filter((s): s is DraftStudent & { row: number; col: number } => s.row !== null && s.col !== null)
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((s) => ({ enrollment_id: s.enrollmentId, row: s.row, col: s.col, locked: s.locked }))
  return { base_version: draft.baseVersion, rows: draft.rows, cols: draft.cols, seats }
}
