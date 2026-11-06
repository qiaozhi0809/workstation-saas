import type { TimetableCell } from '@/shared/types/timetable'

export type Weekday = TimetableCell['weekday']

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
}

export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5]
export const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
