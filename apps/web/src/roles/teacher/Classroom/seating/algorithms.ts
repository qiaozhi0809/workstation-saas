import { gridCells, isPodium, type DeskGrid } from '@/shared/lib/seats'
import type { Cell, DraftStudent } from './draft'

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 固定不动的同学:老师固定的,以及坐在讲台边的(讲台座位不参与排列,也不腾位)。 */
const fixed = (s: DraftStudent) => s.locked || (s.row !== null && isPodium(s))

/** 每排的空座(普通座位,按列升序);固定同学占的座位不算。 */
function freeCells(students: DraftStudent[], grid: DeskGrid): Cell[][] {
  const taken = new Set(students.filter(fixed).map((s) => `${s.row},${s.col}`))
  const lines: Cell[][] = []
  for (let row = 1; row <= grid.rows; row++) lines.push([])
  for (const cell of gridCells(grid)) {
    if (!taken.has(`${cell.row},${cell.col}`)) lines[cell.row - 1].push(cell)
  }
  return lines
}

function assign(students: DraftStudent[], placed: Map<string, Cell>): DraftStudent[] {
  return students.map((s) => {
    if (fixed(s)) return { ...s }
    const cell = placed.get(s.enrollmentId)
    return { ...s, row: cell?.row ?? null, col: cell?.col ?? null }
  })
}

export function shuffleSeats(
  students: DraftStudent[],
  grid: DeskGrid,
  rand: () => number,
): DraftStudent[] {
  const cells = freeCells(students, grid).flat()
  const placed = new Map<string, Cell>()
  shuffled(
    students.filter((s) => !fixed(s)),
    rand,
  ).forEach((s, i) => {
    if (i < cells.length) placed.set(s.enrollmentId, cells[i])
  })
  return assign(students, placed)
}

/** 取出最多 k 个同学放进一桌:男女交替,先手取人数多的一方(一样多则随机),该性别没人了就取另一方。 */
function genderGroups(
  males: DraftStudent[],
  females: DraftStudent[],
  k: number,
  rand: () => number,
): DraftStudent[][] {
  const groups: DraftStudent[][] = []
  while (males.length > 0 && females.length > 0) {
    const maleFirst = males.length === females.length ? rand() < 0.5 : males.length > females.length
    const [a, b] = maleFirst ? [males, females] : [females, males]
    const group: DraftStudent[] = []
    for (let i = 0; i < k; i++) {
      const pool = (i % 2 === 0 ? a : b).length > 0 ? (i % 2 === 0 ? a : b) : i % 2 === 0 ? b : a
      if (pool.length === 0) break
      group.push(pool.pop()!)
    }
    groups.push(group)
  }
  return groups
}

export function genderPairSeats(
  students: DraftStudent[],
  grid: DeskGrid,
  rand: () => number,
): DraftStudent[] {
  const k = grid.deskSize
  const loose = students.filter((s) => !fixed(s))
  const males = shuffled(
    loose.filter((s) => s.gender === 'male'),
    rand,
  )
  const females = shuffled(
    loose.filter((s) => s.gender === 'female'),
    rand,
  )
  const mixed: DraftStudent[][] = []
  const rest: DraftStudent[] = []
  for (const g of genderGroups(males, females, k, rand)) {
    if (g.length === k) mixed.push(g)
    else rest.push(...g)
  }
  rest.push(...males, ...females, ...loose.filter((s) => s.gender === null))
  // 配不上对的同学自己凑桌(同性 / 性别不明)
  const sameSex: DraftStudent[][] = []
  const alone: DraftStudent[] = []
  const pool = shuffled(rest, rand)
  for (let i = 0; i < pool.length; i += k) {
    const chunk = pool.slice(i, i + k)
    if (chunk.length === k) sameSex.push(chunk)
    else alone.push(...chunk)
  }
  // 桌子不够时男女混合的桌优先落座,同性凑的桌排在后面(L257 / Q4);两层各自打乱,桌位仍是随机的
  return placeGroups(
    students,
    grid,
    [...shuffled(mixed, rand), ...shuffled(sameSex, rand)],
    alone,
    rand,
  )
}

/**
 * 把成好的同桌组按给定顺序放进空桌(桌子不够时排在后面的组进待安排;组内左右随机翻转),
 * 落单的和放不下的补进散座 / 剩余座位。调用方自己决定组的顺序(要随机就先 shuffled 再传进来)。
 * 整桌 = 同一排里第 p*k+1 .. p*k+k 列都空着;凑不成整桌的空座是散座。
 */
function placeGroups(
  students: DraftStudent[],
  grid: DeskGrid,
  groups: DraftStudent[][],
  alone: DraftStudent[],
  rand: () => number,
  /** 补位顺序:默认落单的在前、放不下的组在后;优带弱要求有名次的先补、没名次的最后 */
  orderLeftovers: (alone: DraftStudent[], queue: DraftStudent[]) => DraftStudent[] = (a, q) => [
    ...a,
    ...q,
  ],
): DraftStudent[] {
  const k = grid.deskSize
  const desks: Cell[][] = []
  const singles: Cell[] = []
  for (const line of freeCells(students, grid)) {
    const free = new Set(line.map((c) => c.col))
    const inDesk = new Set<number>()
    for (let start = 1; start + k - 1 <= grid.cols; start += k) {
      const cols = Array.from({ length: k }, (_, i) => start + i)
      if (cols.every((c) => free.has(c))) {
        cols.forEach((c) => inDesk.add(c))
        desks.push(cols.map((col) => ({ row: line[0].row, col })))
      }
    }
    for (const cell of line) if (!inDesk.has(cell.col)) singles.push(cell)
  }

  const placed = new Map<string, Cell>()
  const queue: DraftStudent[] = []
  const unusedDesks = [...desks]
  for (const group of groups) {
    const desk = unusedDesks.shift()
    if (!desk) {
      queue.push(...group)
      continue
    }
    const seats = rand() < 0.5 ? desk : [...desk].reverse()
    group.forEach((s, i) => placed.set(s.enrollmentId, seats[i]))
  }

  const seats = [...singles, ...unusedDesks.flat()]
  orderLeftovers(alone, queue).forEach((s, i) => {
    if (i < seats.length) placed.set(s.enrollmentId, seats[i])
  })
  return assign(students, placed)
}

/**
 * 优带弱:有名次的按名次升序成 list;每组取第一名,k >= 2 再取最后一名,k >= 3 再把 list 正中间的人插到第二位。
 * 凑不满一桌的(奇数余下的)和没有名次的单独,没名次的最后。
 */
export function mentorSeats(
  students: DraftStudent[],
  grid: DeskGrid,
  ranks: Map<string, number>,
  rand: () => number,
): DraftStudent[] {
  const k = grid.deskSize
  const loose = students.filter((s) => !fixed(s))
  const list = loose
    .filter((s) => ranks.has(s.enrollmentId))
    .sort((a, b) => ranks.get(a.enrollmentId)! - ranks.get(b.enrollmentId)!)
  const unranked = loose.filter((s) => !ranks.has(s.enrollmentId))
  const alone: DraftStudent[] = []
  const groups: DraftStudent[][] = []
  while (list.length > 0) {
    const g = [list.shift()!]
    if (k >= 2 && list.length > 0) g.push(list.pop()!)
    if (k >= 3 && list.length > 0) g.splice(1, 0, list.splice(Math.floor(list.length / 2), 1)[0])
    if (g.length === k) groups.push(g)
    else alone.push(...g)
  }
  // 哪组坐哪张桌随机;没坐进整桌的:有名次的组先补空位,然后是落单的有名次同学,没成绩的最后
  return placeGroups(students, grid, shuffled(groups, rand), alone, rand, (a, q) => [
    ...q,
    ...a,
    ...unranked,
  ])
}
