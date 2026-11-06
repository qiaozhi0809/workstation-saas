import { Badge } from '@/shared/components/ui/badge'
import { cellState, type Row } from '@/shared/lib/grades'
import { cn } from '@/shared/lib/utils'
import type { SubjectFull } from '@/shared/types/grades'
import type { Grading } from '@/shared/types/school'

function Change({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-muted-foreground">—</span>
  if (value > 0) return <span className="text-success">↑{value}</span>
  if (value < 0) return <span className="text-destructive">↓{-value}</span>
  return <span className="text-muted-foreground">0</span>
}

/** rows/changes 的 id 是 enrollment_id;changes 为 null 表示没有对比,不显示进退列;ratios:学校及格比例(useGrading()) */
export function RankTable({
  subjects,
  rows,
  changes,
  names,
  ratios,
  onOpen,
}: {
  subjects: SubjectFull[]
  rows: Row[]
  changes: Map<string, number> | null
  names: Map<string, string>
  ratios: Grading
  onOpen: (enrollmentId: string) => void
}) {
  return (
    <section aria-label="成绩排名" className="rounded-lg border bg-card text-card-foreground">
      <h2 className="px-3 pt-3 text-base font-semibold">成绩排名</h2>
      <div data-testid="rank-scroll" className="max-h-[460px] overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              {[
                '名次',
                '姓名',
                ...subjects.map((s) => s.name),
                '总分',
                ...(changes ? ['进退'] : []),
              ].map((h) => (
                <th key={h} scope="col" className="sticky top-0 bg-card px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted">
                <td className="px-3 py-2">{r.rank ?? '—'}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => onOpen(r.id)}
                  >
                    {names.get(r.id) ?? r.id}
                  </button>
                </td>
                {subjects.map((s) => {
                  const state = cellState(r.subs[s.name], s.full, ratios)
                  return (
                    <td
                      key={s.name}
                      className={cn('px-3 py-2', state === 'low' && 'text-destructive')}
                    >
                      {state === 'absent' ? (
                        <Badge variant="warning">缺考</Badge>
                      ) : state === 'empty' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        r.subs[s.name]
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 font-medium">{r.total ?? '—'}</td>
                {changes && (
                  <td className="px-3 py-2">
                    <Change value={changes.get(r.id)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
