import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { attendanceApi } from '@/shared/api/attendance'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { growthApi } from '@/shared/api/growth'
import { reviewsApi } from '@/shared/api/reviews'
import { studentsApi } from '@/shared/api/students'
import { ScoreRadar } from '@/shared/components/charts/ScoreRadar'
import { TrendLine } from '@/shared/components/charts/TrendLine'
import { daysUntilBirthday, formatMonthDay } from '@/shared/lib/date'
import {
  examStats,
  examTable,
  latestExam,
  previousExam,
  rankChanges,
  studentTrend,
  subjectStats,
} from '@/shared/lib/grades'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { toast } from '@/shared/components/Toast'
import type { StudentProfile } from '@/shared/types/student'
import Field from './Field'
import { GROWTH_TONE } from './GrowthTab'
import { useStudentDrawer } from './useStudentDrawer'

// eslint-disable-next-line react-refresh/only-export-components
export const CLASS_ROLE_PRESETS = [
  '班长',
  '副班长',
  '学习委员',
  '纪律委员',
  '体育委员',
  '文艺委员',
  '劳动委员',
  '宣传委员',
  '心理委员',
  '语文课代表',
  '数学课代表',
  '英语课代表',
  '小组长',
]

function ClassRoleRow({ student }: { student: StudentProfile }) {
  const queryClient = useQueryClient()
  const current = student.class_role ?? ''
  const [value, setValue] = useState(current)
  const [seen, setSeen] = useState(current)
  // 服务端的值变了(保存后重新拉取)就以服务端为准
  if (seen !== current) {
    setSeen(current)
    setValue(current)
  }
  const save = useMutation({
    mutationFn: (next: string) =>
      studentsApi.setClassRole(student.class_id, student.enrollment_id, next || null),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student', student.id] }),
        queryClient.invalidateQueries({ queryKey: ['class-students', student.class_id] }),
        queryClient.invalidateQueries({ queryKey: ['student-records', student.class_id] }),
      ]),
    onError: (err) => {
      setValue(current)
      toast(err instanceof ApiError ? err.message : '保存失败,请重试')
    },
  })
  const options =
    value && !CLASS_ROLE_PRESETS.includes(value)
      ? [...CLASS_ROLE_PRESETS, value]
      : CLASS_ROLE_PRESETS

  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-muted-foreground">职务</dt>
      <dd>
        <NativeSelect
          aria-label="职务"
          className="h-8"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            save.mutate(e.target.value)
          }}
        >
          <option value="">无</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      </dd>
    </div>
  )
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function PointsCard({ student }: { student: StudentProfile }) {
  const { data } = useQuery({
    queryKey: ['review-summary', student.class_id],
    queryFn: () => reviewsApi.summary(student.class_id),
  })
  if (!data) return <KpiCard title="累计积分" value="—" />
  const mine = data.items.find((r) => r.enrollment_id === student.enrollment_id)
  return (
    <KpiCard
      title="累计积分"
      value={String(mine?.total ?? 0)}
      hint={`点评 ${(mine?.plus_count ?? 0) + (mine?.minus_count ?? 0)} 次`}
    />
  )
}

function AttendanceCard({ student, today }: { student: StudentProfile; today: string }) {
  const month = today.slice(0, 7)
  const { data } = useQuery({
    queryKey: ['attendance-month', student.class_id, month],
    queryFn: () => attendanceApi.month(student.class_id, month),
    staleTime: 0, // 考勤随时会改，抽屉每次打开都要重新取
  })
  if (!data) return <KpiCard title="本月考勤" value="—" />
  const mine = data.items.filter((r) => r.enrollment_id === student.enrollment_id)
  if (mine.length === 0)
    return (
      <KpiCard title="本月考勤" value="全勤" hint={`${Number(month.slice(5))}月无请假缺勤迟到`} />
    )
  const count = (status: string) => mine.filter((r) => r.status === status).length
  const days = new Set(mine.filter((r) => r.status !== 'late').map((r) => r.date)).size
  return (
    <KpiCard
      title="本月考勤"
      value={`${days} 天未到`}
      hint={`请假 ${count('leave')} · 缺勤 ${count('absent')} · 迟到 ${count('late')}`}
    />
  )
}

function BirthdayCard({
  birthdate,
  today,
}: {
  birthdate: string | null | undefined
  today: string
}) {
  if (!birthdate) return <KpiCard title="生日" value="未填" />
  const days = daysUntilBirthday(birthdate, today)
  return (
    <KpiCard
      title="生日"
      value={formatMonthDay(birthdate)}
      hint={days === 0 ? '就是今天' : `${days} 天后`}
    />
  )
}

const roundOrNull = (v: number | null) => (v === null ? null : Math.round(v))

function ScoreBlocks({ student, enabled }: { student: StudentProfile; enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['gradebook', student.class_id],
    queryFn: () => examsApi.gradebook(student.class_id),
    enabled,
  })
  // 无权限、出错或没有成绩:不显示这三块
  if (!data) return null
  const me = student.enrollment_id
  const ids = [...new Set(data.exams.flatMap((e) => Object.keys(e.scores)))]
  const withMe = data.exams.filter((e) => e.scores[me])
  const latest = latestExam(withMe)
  if (!latest) return null

  const cur = examTable(latest, ids)
  const row = cur.find((r) => r.id === me)
  const prev = previousExam(withMe, latest.id)
  const change = rankChanges(cur, prev ? examTable(prev, ids) : null).get(me)

  const trend = studentTrend(withMe, me, ids)
  const classRate = withMe.map((e) => examStats(e, ids)?.rate ?? null)
  const axes = latest.subjects.flatMap((s) => {
    const v = latest.scores[me]?.[s.name]
    return typeof v === 'number'
      ? [
          {
            name: s.name,
            mine: Math.round((v / s.full) * 100),
            avg: roundOrNull(subjectStats(latest, s.name, ids)?.rate ?? null),
          },
        ]
      : []
  })

  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="mb-1 text-sm font-medium">最近考试 · {latest.name}</h3>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold">{row?.total ?? '—'}</span>
          {row?.rank != null && <span className="text-sm">第 {row.rank} 名</span>}
          {change !== undefined && change !== 0 && (
            <span className="text-sm text-muted-foreground">
              {change > 0 ? `↑${change}` : `↓${-change}`}
            </span>
          )}
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium">总分得分率</h3>
        <TrendLine
          label="总分得分率"
          labels={trend.map((p) => p.name)}
          domain={[40, 100]}
          endLabel
          format={(v) => `${Math.round(v)}%`}
          series={[
            { key: 'avg', label: '班级平均', values: classRate, muted: true },
            { key: 'me', label: student.name, values: trend.map((p) => p.rate) },
          ]}
        />
      </section>
      {axes.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-medium">学科画像</h3>
          <ScoreRadar
            label="学科画像"
            axes={axes.map((a) => a.name)}
            series={[
              { key: 'me', label: student.name, values: axes.map((a) => a.mine) },
              { key: 'avg', label: '班级平均', values: axes.map((a) => a.avg), muted: true },
            ]}
          />
        </section>
      )}
    </div>
  )
}

function RecentGrowth({ student }: { student: StudentProfile }) {
  const { open } = useStudentDrawer()
  const { data } = useQuery({
    queryKey: ['growth', student.id],
    queryFn: () => growthApi.list(student.id),
  })
  // 没有记录(或加载失败)时不显示这一块
  if (!data || data.items.length === 0) return null
  return (
    <section className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium">最近成长记录</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => open(student.id, '成长记录')}
        >
          查看全部
        </Button>
      </div>
      <ul className="space-y-1 text-sm">
        {data.items.slice(0, 3).map((r) => (
          <li key={r.id} className="flex items-baseline gap-2">
            <span className="shrink-0 text-muted-foreground">{r.date}</span>
            <Badge variant={GROWTH_TONE[r.type]}>{r.type}</Badge>
            <span className="min-w-0 break-words">{r.content}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function OverviewTab({ student }: { student: StudentProfile }) {
  const summary = useQuery({
    queryKey: ['classroom', student.class_id],
    queryFn: () => classroomApi.summary(student.class_id),
  })
  const canEdit = summary.data?.my_perms.includes('student.write_basic') ?? false
  return (
    <>
      <dl>
        <Field label="编号" value={student.mk} />
        <Field label="学号" value={student.student_no} />
        <Field label="性别" value={student.gender} />
        {canEdit ? (
          <ClassRoleRow student={student} />
        ) : (
          <Field label="职务" value={student.class_role} />
        )}
      </dl>
      {summary.data && (
        <div role="group" aria-label="概况指标" className="mt-4 grid grid-cols-3 gap-2">
          {summary.data.my_perms.includes('review.read') && <PointsCard student={student} />}
          {summary.data.my_perms.includes('attendance.read') && (
            <AttendanceCard student={student} today={summary.data.today} />
          )}
          <BirthdayCard birthdate={student.birthdate} today={summary.data.today} />
        </div>
      )}
      <ScoreBlocks
        student={student}
        enabled={summary.data?.my_perms.includes('exam.read') ?? false}
      />
      {summary.data?.my_perms.includes('growth.read') && <RecentGrowth student={student} />}
    </>
  )
}
