import { Badge } from '@/shared/components/ui/badge'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { cn } from '@/shared/lib/utils'
import type { Exam } from '@/shared/types/grades'

export const GRADE_EXAM_LABEL = '年级联考'

/**
 * 考试列表(服务端按新到旧返回)。≥ lg 是左栏列表,窄屏变成顶部的下拉选择。
 */
export default function ExamList({
  exams,
  currentId,
  onSelect,
}: {
  exams: Exam[]
  currentId: string | null
  onSelect(id: string): void
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm lg:hidden">
        <span className="text-muted-foreground">选择考试</span>
        <NativeSelect value={currentId ?? ''} onChange={(e) => onSelect(e.target.value)}>
          {exams.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}({x.date}){x.grade_exam_id ? ` · ${GRADE_EXAM_LABEL}` : ''}
            </option>
          ))}
        </NativeSelect>
      </label>
      <nav aria-label="考试列表" className="hidden lg:block">
        <ul className="flex flex-col gap-2">
          {exams.map((x) => {
            const current = x.id === currentId
            const { entered, total } = x.progress
            const pct = total > 0 ? Math.min(100, Math.round((entered / total) * 100)) : 0
            return (
              <li key={x.id}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onSelect(x.id)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent',
                    current ? 'border-primary bg-accent' : 'border-border bg-background',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{x.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {x.grade_exam_id && <Badge variant="info">{GRADE_EXAM_LABEL}</Badge>}
                      <Badge variant="neutral">{x.exam_type}</Badge>
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {x.date} · {x.subjects.length} 科
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      已录 {entered}/{total}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
