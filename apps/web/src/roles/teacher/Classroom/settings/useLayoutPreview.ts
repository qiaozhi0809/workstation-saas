import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { seatingApi } from '@/shared/api/seating'
import type { LayoutDraft, LayoutPreview } from '@/shared/types/seating'

const DEBOUNCE_MS = 250

export function useLayoutPreview(
  classId: string,
  draft: LayoutDraft,
): {
  data?: LayoutPreview
  /** 产生 data 的(防抖后的)草稿 */ settled: LayoutDraft
  isFetching: boolean
  isError: boolean
} {
  const [settled, setSettled] = useState(draft)
  useEffect(() => {
    const t = setTimeout(() => setSettled(draft), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [draft])
  const q = useQuery({
    queryKey: ['layout-preview', classId, settled],
    queryFn: () => seatingApi.preview(classId, settled),
    placeholderData: keepPreviousData,
  })
  // 请求失败时 placeholderData 不再生效,自己留住上一次成功的结果
  // keepPreviousData 期间 q.data 仍是上一份草稿的结果,所以连同产生它的草稿一起留住
  const last = useRef<{ data: LayoutPreview; settled: LayoutDraft } | undefined>(undefined)
  if (q.data && !q.isPlaceholderData) {
    last.current = { data: q.data, settled }
  } else if (q.data && !last.current) last.current = { data: q.data, settled }
  return {
    data: last.current?.data,
    settled: last.current?.settled ?? settled,
    isFetching: q.isFetching,
    isError: q.isError,
  }
}
