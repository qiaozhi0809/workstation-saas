import { useState } from 'react'
import AckForm from '@/shared/components/notices/AckForm'
import { Button } from '@/shared/components/ui/button'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import { cn } from '@/shared/lib/utils'
import type { InboxItem } from '@/shared/types/admin'

/** 收件箱下拉里的列表:点一条展开正文,未读的同时通知上层标为已读 */
export default function NoticeList({ items, unread, onRead, onReadAll, readAllBusy }: {
  items: InboxItem[]
  unread: number
  onRead(id: string): void
  onReadAll(): void
  readAllBusy?: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const toggle = (it: InboxItem) => {
    setOpenId(openId === it.id ? null : it.id)
    if (!it.recalled && !it.read_at) onRead(it.id)
  }

  return (
    <div className="flex w-80 max-w-full flex-col">
      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">暂无通知</p>
      ) : (
        <ul className="max-h-96 divide-y overflow-y-auto">
          {items.map((it) => {
            const isUnread = !it.recalled && !it.read_at
            const expanded = openId === it.id
            const meta = [it.from_name, formatInTz(it.created_at, localTz())].filter(Boolean).join(' · ')
            // 已撤回:不可点,只展示标题与说明
            if (it.recalled) {
              return (
                <li key={it.id} className="flex flex-col gap-1 px-3 py-2 text-sm text-muted-foreground">
                  <span className="min-w-0 break-words">{it.title}</span>
                  <span className="text-xs">{meta}</span>
                  <span className="text-xs">此通知已撤回</span>
                </li>
              )
            }
            // 标题按钮与展开区是兄弟节点:回执表单含按钮,不能嵌在外层 button 里
            return (
              <li key={it.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(it)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-sm px-3 py-2 text-left text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
                    isUnread && 'font-semibold',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isUnread && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    <span className="min-w-0 break-words">{it.title}</span>
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{meta}</span>
                </button>
                {expanded && (
                  <div className="px-3 pb-2 text-sm">
                    {it.content !== null && <p className="whitespace-pre-wrap break-words">{it.content}</p>}
                    {it.ack.kind !== 'none' && <AckForm key={it.id} item={it} />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-end border-t p-1">
        <Button type="button" variant="ghost" size="sm" disabled={unread === 0 || readAllBusy} onClick={onReadAll}>
          全部标为已读
        </Button>
      </div>
    </div>
  )
}
