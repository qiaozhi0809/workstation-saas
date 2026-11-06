import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { noticesApi } from '@/shared/api/notices'
import type { Inbox, InboxItem } from '@/shared/types/admin'

/** 收件箱的查询键:铃铛、家长通知页、家长导航共用一份缓存;各处 invalidateQueries(INBOX_KEY) 照旧命中 */
export const INBOX_KEY = ['notices', 'inbox'] as const

export type InboxPages = InfiniteData<Inbox>

/**
 * 收件箱按页取(L90):第 1 页之后由"加载更多"追加;已取的条数还没到 total 就还有下一页。
 * 每一页的响应都带全量的 unread,徽标取第 1 页的即可,不用把每页的条目数出来。
 */
export function useInbox() {
  return useInfiniteQuery({
    queryKey: INBOX_KEY,
    queryFn: ({ pageParam }) => noticesApi.inbox(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return last.items.length > 0 && loaded < last.total ? pages.length + 1 : undefined
    },
  })
}

/** 已取到的全部条目,按 id 去重:取后页期间来了新通知时,前一页末尾那条会在后一页再出现一次 */
export function inboxItems(data: InboxPages | undefined): InboxItem[] {
  const seen = new Set<string>()
  const out: InboxItem[] = []
  for (const it of data?.pages.flatMap((p) => p.items) ?? []) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    out.push(it)
  }
  return out
}

/** 未读数按全量(后端在每页响应里都给) */
export function inboxUnread(data: InboxPages | undefined): number {
  return data?.pages[0]?.unread ?? 0
}
