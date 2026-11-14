import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { aiApi } from '@/shared/api/ai'
import { toast } from '@/shared/components/Toast'
import { Card } from '@/shared/components/ui/card'
import { IconButton } from '@/shared/components/ui/icon-button'
import { formatInTz } from '@/shared/lib/date'

/** 最近对话(最多 8 个);没有对话时整块不显示。 */
export default function RecentChats({ classId, timezone }: { classId: string; timezone: string }) {
  const qc = useQueryClient()
  const chats = useQuery({
    queryKey: ['ai-chats', classId],
    queryFn: () => aiApi.listChats(classId),
  })
  const remove = useMutation({
    mutationFn: (id: string) => aiApi.deleteChat(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-chats', classId] }),
    onError: () => toast('删除失败,请重试'),
  })
  const items = (chats.data?.items ?? []).slice(0, 8)
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-foreground">最近对话</h2>
      <Card>
        <ul className="divide-y divide-border/60">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              <Link
                to={`/teacher/ai/${c.id}`}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate text-foreground">{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatInTz(c.updated_at, timezone).slice(5)}
                </span>
              </Link>
              <IconButton
                icon={Trash2}
                size="sm"
                aria-label="删除对话"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('删除这个对话?')) remove.mutate(c.id)
                }}
              />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
