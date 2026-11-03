import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { seatingApi } from '@/shared/api/seating'
import type { LayoutDraft, LayoutPreview } from '@/shared/types/seating'

const DEBOUNCE_MS = 250

export function useLayoutPreview(
  classId: string,
  draft: LayoutDraft,
): { data?: LayoutPreview; isFetching: boolean; isError: boolean } {
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
  const last = useRef<LayoutPreview>()
  if (q.data) last.current = q.data
  return { data: q.data ?? last.current, isFetching: q.isFetching, isError: q.isError }
}
