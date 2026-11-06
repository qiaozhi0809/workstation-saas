import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { DEFAULT_GRADING } from '@/shared/lib/grades'
import type { Grading } from '@/shared/types/school'

export const GRADING_QUERY_KEY = ['school', 'grading'] as const

/**
 * 学校的及格 / 优秀比例。加载中或加载失败时先用默认值占位。
 * staleTime 60 秒:管理端保存后失效本键;其他浏览器里的老师下次进页面即按新比例计算。
 */
export function useGrading(): Grading {
  const q = useQuery({
    queryKey: GRADING_QUERY_KEY,
    queryFn: schoolApi.grading,
    staleTime: 60_000,
  })
  return q.data ?? DEFAULT_GRADING
}
