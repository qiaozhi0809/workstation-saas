import { useInfiniteQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query'
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
      // 这里数的是"已翻过的位置数",故意不去重:取后页期间来了新通知,后页会把前页末尾的那条再给一次,
      // 位置数仍与 total 对得上;若按去重后的条数比,会少 1 而多去拿一页空页。新来的那条靠刷新收件箱拿到。
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

/**
 * 标已读成功后就地改缓存(L280):这条写上 read_at,每页都带的全量 unread 一起减一;
 * 不再 invalidate 整个收件箱——那会把已加载的每一页逐页重取一遍。
 */
export function markInboxRead(qc: QueryClient, id: string, readAt = new Date().toISOString()) {
  qc.setQueryData<InboxPages>(INBOX_KEY, (old) => {
    if (!old) return old
    const wasUnread = inboxItems(old).some((i) => i.id === id && !i.read_at && !i.recalled)
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        unread: Math.max(0, p.unread - (wasUnread ? 1 : 0)),
        items: p.items.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: readAt } : i)),
      })),
    }
  })
}

/** 全部标为已读成功后就地改缓存(L280):已加载各页的未读条目写上 read_at,全量 unread 归零 */
export function markInboxAllRead(qc: QueryClient, readAt = new Date().toISOString()) {
  qc.setQueryData<InboxPages>(INBOX_KEY, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            unread: 0,
            items: p.items.map((i) => (i.read_at || i.recalled ? i : { ...i, read_at: readAt })),
          })),
        }
      : old,
  )
}

/**
 * 收到新通知(L280):新通知在最前,只重取第 1 页,不再按已加载页数逐页重取;
 * 已翻过的后页丢弃,"加载更多"会重新出现。
 * 做法是先把缓存裁到第 1 页,再 invalidate:无限查询重取的页数 = 缓存里的页数,于是只取一页;
 * 重取走的是 observer 自己的 options(重试、behavior 都不变),进行中的请求由 invalidate 的 cancelRefetch 取消。
 * 不用 infiniteQuery({ pages: 1 }):它会把 pages / retry 写进 query.options,直到下一次 observer setOptions 才复原。
 */
export function refetchInboxFirstPage(qc: QueryClient): Promise<void> {
  qc.setQueryData<InboxPages>(INBOX_KEY, (old) =>
    old && old.pages.length > 1
      ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
      : old,
  )
  return qc.invalidateQueries({ queryKey: INBOX_KEY })
}
