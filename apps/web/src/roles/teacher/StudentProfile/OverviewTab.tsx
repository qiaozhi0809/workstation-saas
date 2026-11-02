import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { ScoreRadar } from '@/shared/components/charts/ScoreRadar'
import { TrendLine } from '@/shared/components/charts/TrendLine'
import { examStats, examTable, latestExam, previousExam, rankChanges, studentTrend, subjectStats } from '@/shared/lib/grades'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { toast } from '@/shared/components/Toast'
import type { StudentProfile } from '@/shared/types/student'
import Field from './Field'

// eslint-disable-next-line react-refresh/only-export-components
export const CLASS_ROLE_PRESETS = [
  '班长', '副班长', '学习委员', '纪律委员', '体育委员', '文艺委员', '劳动委员', '宣传委员', '心理委员',
  '语文课代表', '数学课代表', '英语课代表', '小组长',
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
    mutationFn: (next: string) => studentsApi.setClassRole(student.class_id, student.enrollment_id, next || null),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['student', student.id] }),
      queryClient.invalidateQueries({ queryKey: ['class-students', student.class_id] }),
      queryClient.invalidateQueries({ queryKey: ['student-records', student.class_id] }),
    ]),
    onError: (err) => {
      setValue(current)
      toast(err instanceof ApiError ? err.message : '保存失败,请重试')
    },
  })
  const options = value && !CLASS_ROLE_PRESETS.includes(value) ? [...CLASS_ROLE_PRESETS, value] : CLASS_ROLE_PRESETS

  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-muted-foreground">职务</dt>
      <dd>
        <NativeSelect aria-label="职务" className="h-8" value={value}
          onChange={(e) => { setValue(e.target.value); save.mutate(e.target.value) }}>
          <option value="">无</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      </dd>
    </div>
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
    return typeof v === 'number' ? [{ name: s.name, mine: Math.round((v / s.full) * 100), avg: roundOrNull(subjectStats(latest, s.name, ids)?.rate ?? null) }] : []
  })

  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="mb-1 text-sm font-medium">最近考试 · {latest.name}</h3>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold">{row?.total ?? '—'}</span>
          {row?.rank != null && <span className="text-sm">第 {row.rank} 名</span>}
          {change !== undefined && change !== 0 && (
            <span className="text-sm text-muted-foreground">{change > 0 ? `↑${change}` : `↓${-change}`}</span>
          )}
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-medium">总分得分率</h3>
        <TrendLine label="总分得分率" labels={trend.map((p) => p.name)} domain={[40, 100]} endLabel
          format={(v) => `${Math.round(v)}%`}
          series={[
            { key: 'avg', label: '班级平均', values: classRate, muted: true },
            { key: 'me', label: student.name, values: trend.map((p) => p.rate) },
          ]} />
      </section>
      {axes.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-medium">学科画像</h3>
          <ScoreRadar label="学科画像" axes={axes.map((a) => a.name)}
            series={[
              { key: 'me', label: student.name, values: axes.map((a) => a.mine) },
              { key: 'avg', label: '班级平均', values: axes.map((a) => a.avg), muted: true },
            ]} />
        </section>
      )}
    </div>
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
        {canEdit ? <ClassRoleRow student={student} /> : <Field label="职务" value={student.class_role} />}
      </dl>
      <ScoreBlocks student={student} enabled={summary.data?.my_perms.includes('exam.read') ?? false} />
    </>
  )
}
