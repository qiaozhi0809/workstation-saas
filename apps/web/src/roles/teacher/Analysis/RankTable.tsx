import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
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
    <Card>
      <section aria-label="成绩排名">
        <h2 className="px-4 pt-4 text-base font-medium">成绩排名</h2>
        <div data-testid="rank-scroll" className="mt-2 max-h-[460px] overflow-auto">
          <Table containerClassName="overflow-visible rounded-none bg-transparent shadow-none">
            <TableHead>
              <TableRow>
                <Th className="sticky top-0 bg-card">名次</Th>
                <Th className="sticky top-0 bg-card">姓名</Th>
                {subjects.map((s) => (
                  <Th key={s.name} numeric className="sticky top-0 bg-card">
                    {s.name}
                  </Th>
                ))}
                <Th numeric className="sticky top-0 bg-card">
                  总分
                </Th>
                {changes && (
                  <Th numeric className="sticky top-0 bg-card">
                    进退
                  </Th>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted">
                  <Td>{r.rank ?? '—'}</Td>
                  <Td>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="px-0"
                      onClick={() => onOpen(r.id)}
                    >
                      {names.get(r.id) ?? r.id}
                    </Button>
                  </Td>
                  {subjects.map((s) => {
                    const state = cellState(r.subs[s.name], s.full, ratios)
                    return (
                      <Td
                        key={s.name}
                        numeric
                        className={cn(state === 'low' && 'text-destructive')}
                      >
                        {state === 'absent' ? (
                          <Badge variant="warning">缺考</Badge>
                        ) : state === 'empty' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          r.subs[s.name]
                        )}
                      </Td>
                    )
                  })}
                  <Td numeric className="font-medium">
                    {r.total ?? '—'}
                  </Td>
                  {changes && (
                    <Td numeric>
                      <Change value={changes.get(r.id)} />
                    </Td>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </Card>
  )
}
