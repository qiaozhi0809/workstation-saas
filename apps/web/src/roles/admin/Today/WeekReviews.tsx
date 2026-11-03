import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { TONE_FILL, TONE_TEXT, scoreTone } from '@/shared/lib/tone'
import { cn } from '@/shared/lib/utils'
import type { TodayView } from '@/shared/types/admin'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

export function WeekReviews({ data }: { data: TodayView['week_reviews'] }) {
  // 后端总会列出每个可见班(没点评时 plus / minus 为 0),有没有点评只看老师次数
  if (data.teachers.length === 0) {
    return <EmptyState title="本周还没有点评" />
  }
  const max = Math.max(1, ...data.classes.map((c) => Math.abs(c.net)))
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Block title="班级净分">
        <ul className="flex flex-col gap-2">
          {data.classes.map((c) => (
            <li key={c.class_id} className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-2">
                <span>{c.class_name}</span>
                <span className={cn('font-medium', TONE_TEXT[scoreTone(c.net)])}>{signed(c.net)}</span>
              </div>
              <div aria-hidden="true" className="h-1.5 rounded bg-muted">
                <div className={cn('h-full rounded', TONE_FILL[scoreTone(c.net)])} style={{ width: `${(Math.abs(c.net) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="需要关注的同学">
        {data.bottom.length === 0 ? <p className="text-sm text-muted-foreground">暂无</p> : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {data.bottom.map((b) => (
              <li key={b.student_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{b.name}<span className="ml-2 text-muted-foreground">{b.class_name}</span></span>
                <span className={cn('font-medium', TONE_TEXT[scoreTone(b.net)])}>{signed(b.net)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="老师点评次数">
        {data.teachers.length === 0 ? <p className="text-sm text-muted-foreground">暂无</p> : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {data.teachers.map((t) => (
              <li key={t.user_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{t.display_name}</span><span className="font-medium">{`${t.count} 次`}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  )
}
