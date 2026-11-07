import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { DEFAULT_GRADING } from '@/shared/lib/grades'
import type { Grading } from '@/shared/types/school'

export const GRADING_QUERY_KEY = ['school', 'grading'] as const

export interface GradingState extends Grading {
  /** 学校比例读取失败、当前按默认 60% / 85% 显示(L236);成绩 / 分析页据此在页顶提示并给重试 */
  failed: boolean
  retry: () => void
}

/**
 * 学校的及格 / 优秀比例。加载中或加载失败时先用默认值占位;失败不再静默,failed 为真。
 * 后台刷新失败但手里有上一次的值时不算失败,继续用旧值。
 * staleTime 60 秒:管理端保存后失效本键;其他浏览器里的老师下次进页面即按新比例计算。
 */
export function useGrading(): GradingState {
  const { data, isError, refetch } = useQuery({
    queryKey: GRADING_QUERY_KEY,
    queryFn: schoolApi.grading,
    staleTime: 60_000,
  })
  return useMemo(
    () => ({
      ...(data ?? DEFAULT_GRADING),
      failed: isError && data === undefined,
      retry: () => void refetch(),
    }),
    [data, isError, refetch],
  )
}
