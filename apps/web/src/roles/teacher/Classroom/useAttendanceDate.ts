import { useCallback, useState } from 'react'

/**
 * 考勤查看日期。没有手动选过时跟随服务端下发的学校"今天"(过了零点概况刷新后自动换到新的一天);
 * 手动选了别的日期就停在那天,直到 followToday()。选中的恰好是今天也算"跟随今天"。
 */
export function useAttendanceDate(today: string | undefined): {
  date: string | undefined
  pick(d: string): void
  followToday(): void
} {
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const pick = useCallback((d: string) => setPicked(d === today ? undefined : d), [today])
  const followToday = useCallback(() => setPicked(undefined), [])
  return { date: picked ?? today, pick, followToday }
}
