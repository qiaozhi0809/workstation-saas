import AckForm from '@/shared/components/notices/AckForm'
import { Badge } from '@/shared/components/ui/badge'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import { cn } from '@/shared/lib/utils'
import type { InboxItem } from '@/shared/types/admin'

/** 家长通知页的一条:标题行可点开;未读加粗;需要回执且未回执的带"待回执" */
export default function ParentNoticeItem({
  item,
  open,
  onToggle,
}: {
  item: InboxItem
  open: boolean
  onToggle(): void
}) {
  const unread = !item.recalled && !item.read_at
  const pending = !item.recalled && item.ack.kind !== 'none' && !item.my_ack && item.can_ack
  const meta = [
    item.from_name,
    formatInTz(item.created_at, localTz()),
    item.students.length > 0 ? `涉及:${item.students.join('、')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  // 已撤回:不可点、不是按钮(与铃铛里的 NoticeList 一致),只展示标题与说明
  if (item.recalled) {
    return (
      <li className="flex min-h-[44px] flex-col gap-1 px-3 py-2 text-sm text-muted-foreground">
        <span className="min-w-0 break-words">{item.title}</span>
        <span className="text-xs">{meta}</span>
        <span className="text-xs">此通知已撤回</span>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex min-h-[44px] w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          unread && 'font-semibold',
        )}
      >
        <span className="flex items-center gap-2">
          {unread && (
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          )}
          <span className="min-w-0 break-words">{item.title}</span>
          {pending && (
            <Badge variant="warning" className="shrink-0">
              待回执
            </Badge>
          )}
        </span>
        <span className="text-xs font-normal text-muted-foreground">{meta}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-sm">
          {item.content !== null && (
            <p className="whitespace-pre-wrap break-words">{item.content}</p>
          )}
          <AckForm key={item.id} item={item} />
        </div>
      )}
    </li>
  )
}
