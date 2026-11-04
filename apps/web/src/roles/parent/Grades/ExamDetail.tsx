import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'

const num = (v: number | null) => (v === null ? '—' : String(v))

export default function ExamDetail({ sid, examId }: { sid: string; examId: string }) {
  const q = useQuery({ queryKey: ['parent', sid, 'exam', examId], queryFn: () => parentApi.exam(sid, examId) })
  if (q.isError) return <ErrorState title="成绩加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
  if (!q.data) return <LoadingState />
  const d = q.data

  return (
    <div className="space-y-3 text-sm">
      <div className="overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="各科成绩">
        <table className="w-full min-w-[26rem] text-left">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">科目</th>
              <th scope="col" className="px-3 py-2 font-medium">分数 / 满分</th>
              <th scope="col" className="px-3 py-2 font-medium">班级平均</th>
              <th scope="col" className="px-3 py-2 font-medium">班级最高</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.subjects.map((s) => (
              <tr key={s.name}>
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium">{s.name}</th>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {s.score === null ? <span className="text-muted-foreground">缺考</span> : `${s.score} / ${s.full}`}
                </td>
                <td className="px-3 py-2 tabular-nums">{num(s.class_avg)}</td>
                <td className="px-3 py-2 tabular-nums">{num(s.class_max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-semibold">总分 {d.total === null ? '—' : `${d.total} / ${d.total_full}`}</p>
      {d.class_rank !== null ? (
        <p data-testid="rank-line">班级第 {d.class_rank} 名 / 共 {d.ranked} 人</p>
      ) : d.band ? (
        <p data-testid="rank-line">班级{d.band}</p>
      ) : null}
    </div>
  )
}
