import type { Cell, DraftStudent } from './draft'

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function freeCells(students: DraftStudent[], rows: number, cols: number): Cell[][] {
  const taken = new Set(students.filter((s) => s.locked).map((s) => `${s.row},${s.col}`))
  const grid: Cell[][] = []
  for (let row = 1; row <= rows; row++) {
    const line: Cell[] = []
    for (let col = 1; col <= cols; col++) {
      if (!taken.has(`${row},${col}`)) line.push({ row, col })
    }
    grid.push(line)
  }
  return grid
}

function assign(students: DraftStudent[], placed: Map<string, Cell>): DraftStudent[] {
  return students.map((s) => {
    if (s.locked) return { ...s }
    const cell = placed.get(s.enrollmentId)
    return { ...s, row: cell?.row ?? null, col: cell?.col ?? null }
  })
}

export function shuffleSeats(
  students: DraftStudent[],
  rows: number,
  cols: number,
  rand: () => number,
): DraftStudent[] {
  const cells = freeCells(students, rows, cols).flat()
  const placed = new Map<string, Cell>()
  shuffled(students.filter((s) => !s.locked), rand).forEach((s, i) => {
    if (i < cells.length) placed.set(s.enrollmentId, cells[i])
  })
  return assign(students, placed)
}

export function genderPairSeats(
  students: DraftStudent[],
  rows: number,
  cols: number,
  rand: () => number,
): DraftStudent[] {
  const desks: [Cell, Cell][] = []
  const singles: Cell[] = []
  for (const line of freeCells(students, rows, cols)) {
    const free = new Set(line.map((c) => c.col))
    for (const cell of line) {
      if (cell.col % 2 === 1 && free.has(cell.col + 1)) {
        desks.push([cell, { row: cell.row, col: cell.col + 1 }])
      } else if (!(cell.col % 2 === 0 && free.has(cell.col - 1))) {
        singles.push(cell)
      }
    }
  }

  const loose = students.filter((s) => !s.locked)
  const males = shuffled(loose.filter((s) => s.gender === 'male'), rand)
  const females = shuffled(loose.filter((s) => s.gender === 'female'), rand)
  const pairs: DraftStudent[][] = []
  while (males.length > 0 && females.length > 0) pairs.push([males.pop()!, females.pop()!])
  const rest = shuffled([...males, ...females, ...loose.filter((s) => s.gender === null)], rand)
  const alone: DraftStudent[] = []
  for (let i = 0; i < rest.length; i += 2) {
    if (i + 1 < rest.length) pairs.push([rest[i], rest[i + 1]])
    else alone.push(rest[i])
  }

  const placed = new Map<string, Cell>()
  const queue: DraftStudent[] = []
  const unusedDesks = [...desks]
  for (const pair of shuffled(pairs, rand)) {
    const desk = unusedDesks.shift()
    if (!desk) {
      queue.push(...pair)
      continue
    }
    const [left, right] = rand() < 0.5 ? desk : [desk[1], desk[0]]
    placed.set(pair[0].enrollmentId, left)
    placed.set(pair[1].enrollmentId, right)
  }

  const seats = [...singles, ...unusedDesks.flat()]
  const leftovers = [...alone, ...queue]
  leftovers.forEach((s, i) => {
    if (i < seats.length) placed.set(s.enrollmentId, seats[i])
  })
  return assign(students, placed)
}
