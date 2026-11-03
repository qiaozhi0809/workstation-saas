import { useQueries, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import SeatHoverCard from '@/roles/teacher/Classroom/SeatHoverCard'
import StudentProfileDrawer from '@/roles/teacher/StudentProfile/StudentProfileDrawer'
import { useStudentDrawer } from '@/roles/teacher/StudentProfile/useStudentDrawer'
import { adminApi } from '@/shared/api/admin'
import ClassroomMap from '@/shared/components/ClassroomMap'
import type { ClassroomMapProps } from '@/shared/components/ClassroomMap/types'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { groupOf } from '@/shared/lib/seats'
import { TONE_TEXT, ATTENDANCE_TONE } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import type { BoardClass } from '@/shared/types/admin'
import { STATUS_TEXT, attendanceViews } from './attendanceViews'

/**
 * 单班只读页。领导身份没有"班级版式"端点,教室尺寸 / 座位 / 今日考勤都取自全校看板同一份数据:
 * 先按 ?grade= 查,没带或没找到就依次查其他年级。
 */
function useBoardClass(id: string) {
  const gradeParam = useSearchParams()[0].get('grade')
  const first = useQuery({ queryKey: ['admin', 'board', gradeParam], queryFn: () => adminApi.board(gradeParam) })
  const hit = first.data?.classes.find((c) => c.id === id)
  const rest = first.data && !hit ? first.data.grades.filter((g) => g.id !== first.data!.grade_id) : []
  const others = useQueries({
    queries: rest.map((g) => ({ queryKey: ['admin', 'board', g.id], queryFn: () => adminApi.board(g.id) })),
  })
  const cls: BoardClass | undefined = hit ?? others.flatMap((o) => o.data?.classes ?? []).find((c) => c.id === id)
  return {
    cls,
    error: !cls && (first.isError || others.some((o) => o.isError)),
    loading: !cls && (first.isPending || others.some((o) => o.isPending)),
    refetch: () => { void first.refetch(); others.forEach((o) => void o.refetch()) },
  }
}

export default function ClassViewPage() {
  const id = useParams().id ?? ''
  const { studentId, open } = useStudentDrawer()
  const { cls, error, loading, refetch } = useBoardClass(id)

  const views = useMemo(() => attendanceViews(cls?.attendance ?? {}), [cls?.attendance])
  const podium = useMemo(() => ({ left: cls?.podium_left ?? 0, right: cls?.podium_right ?? 0 }), [cls?.podium_left, cls?.podium_right])
  const onSeatClick = useCallback<NonNullable<ClassroomMapProps['onSeatClick']>>((s) => open(s.student_id), [open])
  const renderHoverCard = useCallback<NonNullable<ClassroomMapProps['renderHoverCard']>>((s) => cls && (
    <SeatHoverCard seat={s} attendance={cls.attendance[s.enrollment_id] ?? 'present'} week={undefined}
      groupOf={(x) => groupOf(x.seat_col ?? 1, cls.desk_size, cls.seat_cols, x.seat_row ?? 1)} />
  ), [cls])

  if (error) return <ErrorState title="加载失败" onRetry={refetch} className="p-6" />
  if (loading) return <LoadingState />
  if (!cls) return <EmptyState title="未找到该班级" className="p-6" />

  const m = cls.metrics
  const nameOf = new Map(cls.seats.map((s) => [s.enrollment_id, s] as const))
  const absent = Object.entries(cls.attendance).flatMap(([eid, status]) => {
    const s = nameOf.get(eid)
    return s ? [{ seat: s, status }] : []
  })
  const title = [cls.name, cls.room, cls.homeroom_name ? `班主任 ${cls.homeroom_name}` : null].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <Link to="/admin/board" className="w-fit rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">← 全校看板</Link>
        <h1 className="text-xl font-semibold">{title}</h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[60vh] min-h-[320px] overflow-hidden rounded-lg border">
          <ClassroomMap mode="daily" rows={cls.seat_rows} cols={cls.seat_cols} deskSize={cls.desk_size} podium={podium}
            seats={cls.seats} views={views} zoomControls
            attendanceBoard={{ title: '出勤', present: m.present, total: m.students, leave: m.leave, absent: m.absent, late: m.late }}
            renderHoverCard={renderHoverCard} onSeatClick={onSeatClick} />
        </div>
        <section aria-labelledby="class-att" className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3">
          <h2 id="class-att" className="sr-only">今日考勤</h2>
          <p className="text-base font-semibold">{`出勤 ${m.present}/${m.students}`}</p>
          <p className="text-sm text-muted-foreground">
            {`请假 ${m.leave} · 缺勤 ${m.absent} · 迟到 ${m.late} · ${m.confirmed ? '考勤已确认' : '未确认考勤'}`}
          </p>
          {absent.length === 0 ? <p className="text-sm text-muted-foreground">今天全员到齐</p> : (
            <ul className="flex flex-col divide-y">
              {absent.map(({ seat, status }) => (
                <li key={seat.enrollment_id} className="py-1.5">
                  <button type="button" onClick={() => open(seat.student_id)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span>{seat.name}</span>
                    <span className={cn('font-medium', TONE_TEXT[ATTENDANCE_TONE[status]])}>{STATUS_TEXT[status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {studentId && <StudentProfileDrawer key={studentId} studentId={studentId} />}
    </div>
  )
}
