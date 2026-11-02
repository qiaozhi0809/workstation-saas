import { useMemo, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { attendanceApi } from '@/shared/api/attendance'
import { toast } from '@/shared/components/Toast'
import type { SeatView } from '@/shared/components/ClassroomMap/types'
import * as csv from '@/shared/lib/csv'
import { formatInTz } from '@/shared/lib/date'
import type { AttendanceDay } from '@/shared/types/attendance'
import type { StudentSeat } from '@/shared/types/student'
import AttendanceBar from './AttendanceBar'
import { ATTENDANCE_LABEL, nextStatus, type MarkStatus } from './cycle'
import { attendanceMonthRows, type RosterRow } from './exportMonth'

/** 当天考勤的座位外观:请假 / 缺勤 淡出并带标签,迟到只带标签。 */
export function attendanceViews(day: AttendanceDay | undefined): Record<string, SeatView> {
  const out: Record<string, SeatView> = {}
  for (const it of day?.items ?? []) {
    out[it.enrollment_id] = { ghost: it.status !== 'late', chip: ATTENDANCE_LABEL[it.status] }
  }
  return out
}

interface Options {
  classId: string
  className: string
  /** 查看的考勤日期(来自 useAttendanceDate;概况未加载时为 undefined) */
  date: string | undefined
  canWrite: boolean
  /** 排座模式不叠加考勤,也不取数 */
  enabled: boolean
  today: string | undefined
  yearStart: string | undefined
  timezone: string | undefined
  roster: StudentSeat[]
  /** 出勤小牌在场景里看得到(ClassroomMap 回报);决定操作台显示数字还是徽章 */
  boardVisible?: boolean
  onPickDate(d: string): void
  onFollowToday(): void
}

const NO_WRITE = '只有班主任和副班主任可以记考勤'

export function useAttendanceMode(o: Options) {
  const { classId, date, canWrite } = o
  const qc = useQueryClient()
  const key = ['attendance', classId, date]
  const day = useQuery({
    queryKey: key,
    queryFn: () => attendanceApi.day(classId, date!),
    enabled: o.enabled && !!date,
  })

  const views = useMemo(() => attendanceViews(day.data), [day.data])

  const mark = useMutation({
    mutationKey: ['attendance-mark', classId],
    mutationFn: (v: { enrollmentId: string; status: MarkStatus }) =>
      attendanceApi.set(classId, date!, v.enrollmentId, { status: v.status }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<AttendanceDay>(key)
      const base: AttendanceDay = prev ?? { date: date!, confirmed_at: null, items: [] }
      const rest = base.items.filter((i) => i.enrollment_id !== v.enrollmentId)
      const items = v.status === 'present' ? rest : [
        ...rest,
        { enrollment_id: v.enrollmentId, status: v.status, reason: null, marked_at: new Date(0).toISOString() },
      ]
      qc.setQueryData<AttendanceDay>(key, { ...base, items })
      return { prev }
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(key, ctx?.prev)
      toast(err.message)
    },
    // 连续点击时只在最后一个请求结束后才失效,否则前一个的回读会覆盖后一个的乐观值
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['attendance-mark', classId] }) <= 1) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
  })

  const confirm = useMutation({
    mutationFn: (clearExceptions: boolean) => attendanceApi.confirm(classId, date!, clearExceptions),
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (err) => toast(err.message),
  })

  const onSeatClick = (seat: StudentSeat) => {
    if (!canWrite) { toast(NO_WRITE); return }
    if (!date) return
    // 以点击时缓存里的最新值为准,连点才能依次轮转
    const cur = qc.getQueryData<AttendanceDay>(key)?.items.find((i) => i.enrollment_id === seat.enrollment_id)
    mark.mutate({ enrollmentId: seat.enrollment_id, status: nextStatus(cur?.status ?? 'present') })
  }

  const exportMonth = async () => {
    if (!date) return
    const month = date.slice(0, 7)
    try {
      const data = await attendanceApi.month(classId, month)
      const rows = attendanceMonthRows(month, o.roster as RosterRow[], data.items)
      csv.downloadText(`${o.className}-考勤-${month}.csv`, csv.toCSV(rows))
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败')
    }
  }

  const items = day.data?.items ?? []
  const count = (s: string) => items.filter((i) => i.status === s).length
  let bar: ReactNode = null
  if (date && o.today && o.yearStart && o.timezone) {
    bar = (
      <AttendanceBar
        date={date}
        today={o.today}
        yearStart={o.yearStart}
        enrolled={o.roster.length}
        leave={count('leave')}
        absent={count('absent')}
        late={count('late')}
        confirmedAt={day.data?.confirmed_at ? formatInTz(day.data.confirmed_at, o.timezone).slice(11) : null}
        boardVisible={o.boardVisible}
        canWrite={canWrite}
        busy={confirm.isPending}
        onPickDate={o.onPickDate}
        onFollowToday={o.onFollowToday}
        onConfirm={() => confirm.mutate(false)}
        onAllPresent={() => {
          // 一键全部出勤会清掉当天已记的异常:有记录时先确认
          if (items.length > 0 && !window.confirm(
            `将清除${date === o.today ? '今天' : '这一天'}已记的 ${items.length} 条请假/缺勤/迟到,确定全部出勤吗?`,
          )) return
          confirm.mutate(true)
        }}
        onExport={() => void exportMonth()}
      />
    )
  }
  return { views, onSeatClick, bar, day: day.data }
}
