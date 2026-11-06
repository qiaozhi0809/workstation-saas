import { useQuery } from '@tanstack/react-query'
import StudentProfileDrawer from '@/roles/teacher/StudentProfile/StudentProfileDrawer'
import { useStudentDrawer } from '@/roles/teacher/StudentProfile/useStudentDrawer'
import { adminApi } from '@/shared/api/admin'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { weekdayCN } from '@/shared/lib/date'
import { AbsenteeList } from './AbsenteeList'
import { GradeExamCard } from './GradeExamCard'
import { KpiRow } from './KpiRow'
import { NoticeCard } from './NoticeCard'
import { SetupChecklist } from './SetupChecklist'
import { UnconfirmedList } from './UnconfirmedList'
import { WeekReviews } from './WeekReviews'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function TodayPage() {
  const { studentId, open } = useStudentDrawer()
  const q = useQuery({ queryKey: ['admin', 'today'], queryFn: adminApi.today })

  if (q.isError)
    return (
      <ErrorState
        title="加载失败"
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
        className="p-6"
      />
    )
  if (!q.data) return <LoadingState />
  const d = q.data

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{`今日关注 · ${d.scope_label}`}</h1>
        <p className="text-sm text-muted-foreground">{`${d.date} ${weekdayCN(d.date)}`}</p>
      </header>
      {/* 开学准备清单:只有 org.manage / settings.manage 看得到,全部完成后折叠成一行 */}
      <SetupChecklist />
      <KpiRow totals={d.totals} />
      {(d.grade_exam || (d.my_notices?.length ?? 0) > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <GradeExamCard exam={d.grade_exam} />
          <NoticeCard notices={d.my_notices} />
        </div>
      )}
      <Section title="今日缺勤与请假">
        <AbsenteeList items={d.absentees} onOpen={open} />
      </Section>
      <Section title="还没确认考勤的班级">
        <UnconfirmedList items={d.unconfirmed} />
      </Section>
      <Section title="本周点评">
        <WeekReviews data={d.week_reviews} />
      </Section>
      {studentId && <StudentProfileDrawer key={studentId} studentId={studentId} />}
    </div>
  )
}
