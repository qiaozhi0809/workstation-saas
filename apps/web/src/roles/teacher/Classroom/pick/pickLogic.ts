import type { AttendanceStatus } from '@/shared/types/attendance'
import type { StudentSeat } from '@/shared/types/student'

export function pickPool(
  seats: Pick<StudentSeat, 'enrollment_id' | 'seat_row' | 'seat_col'>[],
  statusOf: (enrollmentId: string) => AttendanceStatus | undefined,
): string[] {
  return seats
    .filter((s) => s.seat_row !== null && s.seat_col !== null)
    .filter((s) => {
      const st = statusOf(s.enrollment_id)
      return st !== 'leave' && st !== 'absent'
    })
    .map((s) => s.enrollment_id)
}

export function cooldownSize(poolSize: number): number {
  return Math.min(8, Math.max(0, poolSize - 1))
}

export function choosePick(
  pool: string[],
  recent: string[],
  rand: () => number,
): { id: string | null; recent: string[] } {
  if (pool.length === 0) return { id: null, recent: [] }
  let candidates = pool.filter((id) => !recent.includes(id))
  let history = recent
  if (candidates.length === 0) {
    candidates = pool
    history = []
  }
  const id = candidates[Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))]
  const keep = cooldownSize(pool.length)
  return { id, recent: keep === 0 ? [] : [...history, id].slice(-keep) }
}

export function spinDelays(steps = 16, first = 60, factor = 1.15): number[] {
  return Array.from({ length: steps }, (_, i) => first * factor ** i)
}
