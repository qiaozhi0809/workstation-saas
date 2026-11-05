import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { formatMonthDay, weekdayCN } from '@/shared/lib/date'
import { useChild } from '../useChild'
import AttendanceCard from './AttendanceCard'
import MiniClassroom from './MiniClassroom'
import ReviewList from './ReviewList'

export default function TodayPage() {
  const { child } = useChild()
  const sid = child?.student_id ?? ''
  const q = useQuery({
    queryKey: ['parent', sid, 'today'],
    queryFn: () => parentApi.today(sid),
    enabled: !!child,
  })
  if (!child) return null
  if (q.isError)
    return (
      <ErrorState
        title="今日信息加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
      />
    )
  if (!q.data) return <LoadingState />
  const t = q.data

  if (t.status === 'readonly' || child.status === 'readonly') {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <section className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
          {child.left_on ? `孩子已于 ${child.left_on} 毕业 / 离校` : '孩子已毕业 / 离校'}
          ,可以继续查看在校期间的成长与成绩
          {child.archive_on ? `,账号将于 ${child.archive_on} 归档` : ''}
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">
        {formatMonthDay(t.date)} {weekdayCN(t.date)}
      </h1>
      <AttendanceCard attendance={t.attendance} />
      <ReviewList reviews={t.reviews} weekPoints={t.week_points} />
      <MiniClassroom map={t.seat_map} enrollmentId={t.enrollment_id} child={child} />
      {t.class_info && (
        <section
          aria-label="班级信息"
          className="rounded-xl border bg-card p-4 text-sm text-card-foreground"
        >
          <h2 className="text-sm text-muted-foreground">班级信息</h2>
          <p className="mt-1 text-base font-semibold">{t.class_info.class_name}</p>
          <dl className="mt-2 space-y-1">
            <div className="flex gap-3">
              <dt className="w-14 shrink-0 text-muted-foreground">班主任</dt>
              <dd>{t.class_info.homeroom_name ?? '暂无'}</dd>
            </div>
            {(t.class_info.teachers ?? []).map((x) => (
              <div key={`${x.subject}-${x.name}`} className="flex gap-3">
                <dt className="w-14 shrink-0 text-muted-foreground">{x.subject}</dt>
                <dd>{x.name}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
