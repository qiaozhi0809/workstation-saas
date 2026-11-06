import { useQuery } from '@tanstack/react-query'
import { parentApi } from '@/shared/api/parent'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'

const num = (v: number | null | undefined) => (v == null ? '—' : String(v))

export default function ExamDetail({ sid, examId }: { sid: string; examId: string }) {
  const q = useQuery({
    queryKey: ['parent', sid, 'exam', examId],
    queryFn: () => parentApi.exam(sid, examId),
  })
  if (q.isError)
    return (
      <ErrorState title="成绩加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
    )
  if (!q.data) return <LoadingState />
  const d = q.data

  return (
    <div className="space-y-3 text-sm">
      {/*
       * 同一张表两种排法(L83):≥ sm 是四列表格;窄屏(375)每科是一张两行卡片——
       * 第一行 科目 + 分数 / 满分,第二行 班级平均 + 班级最高,不再横向滚动。
       * 表头在窄屏收起,改由单元格里的行内标签说明;显式 role 让 display 改变后仍是一张表。
       */}
      <div className="rounded-lg border" role="region" aria-label="各科成绩">
        <table role="table" className="block w-full text-left sm:table">
          <thead
            role="rowgroup"
            className="hidden bg-muted text-xs text-muted-foreground sm:table-header-group"
          >
            <tr role="row">
              <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                科目
              </th>
              <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                分数 / 满分
              </th>
              <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                班级平均
              </th>
              <th role="columnheader" scope="col" className="px-3 py-2 font-medium">
                班级最高
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block divide-y sm:table-row-group">
            {d.subjects.map((s) => (
              <tr
                key={s.name}
                role="row"
                className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 sm:table-row sm:p-0"
              >
                <th
                  role="rowheader"
                  scope="row"
                  className="block whitespace-nowrap font-medium sm:table-cell sm:px-3 sm:py-2"
                >
                  {s.name}
                </th>
                <td className="block whitespace-nowrap text-right tabular-nums sm:table-cell sm:px-3 sm:py-2 sm:text-left">
                  {s.score == null ? '—' : `${s.score} / ${s.full}`}
                </td>
                <td className="block text-xs text-muted-foreground tabular-nums sm:table-cell sm:px-3 sm:py-2 sm:text-sm sm:text-foreground">
                  <span className="sm:hidden">班级平均 </span>
                  <span>{num(s.class_avg)}</span>
                </td>
                <td className="block text-right text-xs text-muted-foreground tabular-nums sm:table-cell sm:px-3 sm:py-2 sm:text-left sm:text-sm sm:text-foreground">
                  <span className="sm:hidden">班级最高 </span>
                  <span>{num(s.class_max)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">“—”表示暂无成绩</p>
      <p className="font-semibold">总分 {d.total == null ? '—' : `${d.total} / ${d.total_full}`}</p>
      {d.class_rank != null ? (
        <p data-testid="rank-line">
          班级第 {d.class_rank} 名 / 共 {d.ranked} 人
        </p>
      ) : d.band ? (
        <p data-testid="rank-line">班级{d.band}</p>
      ) : null}
    </div>
  )
}
