import { useQuery } from '@tanstack/react-query'
import StudentProfileDrawer from '@/roles/teacher/StudentProfile/StudentProfileDrawer'
import { useStudentDrawer } from '@/roles/teacher/StudentProfile/useStudentDrawer'
import { adminApi } from '@/shared/api/admin'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Badge } from '@/shared/components/ui/badge'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { weekdayCN } from '@/shared/lib/date'
import { useAuthStore } from '@/shared/stores/auth'
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
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  )
}

export default function TodayPage() {
  const { studentId, open } = useStudentDrawer()
  // 业务区块(KPI、缺勤、点评…)只给有 school.view 的人,后端 /admin/today 也是这个权限;
  // 只有 org.manage / settings.manage 的账号(信息中心)只看开学准备卡,并且不发 /admin/today 请求,免得 403
  const canViewSchool = useAuthStore((s) => s.user?.admin_perms.includes('school.view') ?? false)
  const q = useQuery({
    queryKey: ['admin', 'today'],
    queryFn: adminApi.today,
    enabled: canViewSchool,
  })

  if (!canViewSchool)
    return (
      <PageContainer width="default">
        <PageHeader title="今日关注" />
        <SetupChecklist />
      </PageContainer>
    )
  if (q.isError)
    return (
      <PageContainer width="default">
        <PageHeader title="今日关注" />
        <ErrorState title="加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </PageContainer>
    )
  if (!q.data)
    return (
      <PageContainer width="default">
        <PageHeader title="今日关注" />
        <LoadingState variant="cards" />
      </PageContainer>
    )
  const d = q.data

  return (
    <PageContainer width="default">
      <PageHeader
        title="今日关注"
        description={`${d.date} ${weekdayCN(d.date)}`}
        meta={<Badge variant="neutral">{d.scope_label}</Badge>}
      />
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
    </PageContainer>
  )
}
