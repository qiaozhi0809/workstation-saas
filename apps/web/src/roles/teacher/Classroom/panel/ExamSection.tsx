import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { Sparkline } from '@/shared/components/charts/Sparkline'
import { Card } from '@/shared/components/ui/card'
import { examStats, latestExam } from '@/shared/lib/grades'
import type { StudentSeat } from '@/shared/types/student'

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10)

export default function ExamSection({
  classId,
  roster,
}: {
  classId: string
  roster: StudentSeat[]
}) {
  // 与成绩模式、排座共用同一份缓存
  const book = useQuery({
    queryKey: ['gradebook', classId],
    queryFn: () => examsApi.gradebook(classId),
  })
  const exams = book.data?.exams ?? []
  const latest = latestExam(exams)
  const ids = roster.map((s) => s.enrollment_id)
  const rates = exams.map((e) => examStats(e, ids)?.rate ?? null)
  const stats = latest ? examStats(latest, ids) : null
  return (
    <Card className="p-3">
      <h3 className="text-sm font-semibold">最近考试</h3>
      {book.isError && !book.data ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          成绩加载失败
        </p>
      ) : !latest ? (
        <p className="mt-1 text-xs text-muted-foreground">还没有考试成绩</p>
      ) : (
        <div className="mt-1 flex flex-col gap-1 text-xs">
          <p className="font-medium">{latest.name}</p>
          {stats ? (
            <>
              <p>{`平均 ${oneDecimal(stats.avg)}/${stats.full}`}</p>
              <p>{`及格率 ${Math.round(stats.passRate * 100)}% · 优秀率 ${Math.round(stats.goodRate * 100)}%`}</p>
            </>
          ) : (
            <p className="text-muted-foreground">本场还没有录入成绩</p>
          )}
          {rates.filter((r) => r !== null).length >= 2 && (
            <Sparkline label="历次平均得分率" height={48} values={rates} />
          )}
          <Link
            className="text-primary underline-offset-2 hover:underline"
            to={`/teacher/analysis?exam=${latest.id}`}
          >
            查看分析
          </Link>
        </div>
      )}
    </Card>
  )
}
