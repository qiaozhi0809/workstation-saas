import { formatInTz } from '@/shared/lib/date'
import type { ParentComment } from '@/shared/types/parent'

const SCHOOL_TZ = 'Asia/Shanghai'

/** 按学期分组,保持接口给出的先后顺序 */
export default function CommentList({ comments }: { comments: ParentComment[] }) {
  const groups: { semester: string; items: ParentComment[] }[] = []
  for (const c of comments) {
    const g = groups.find((x) => x.semester === c.semester)
    if (g) g.items.push(c)
    else groups.push({ semester: c.semester, items: [c] })
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.semester} aria-label={g.semester} className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{g.semester}</h3>
          <ul className="space-y-2">
            {g.items.map((c) => (
              <li key={c.id} className="rounded-xl border bg-card p-3 text-sm text-card-foreground">
                <p className="break-words whitespace-pre-wrap">{c.content}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatInTz(c.created_at, SCHOOL_TZ).slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
