import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'

/**
 * 学校时区(/meta 的 school_tz,L41 / L43):后端按它算日界,管理端"今天 / 本月"的默认值也要按它算,
 * 否则浏览器时区落后于学校时区时,默认区间会漏掉学校"明天"的记录。
 * ready 为假时还没拿到(或取不到)时区,tz 先退回浏览器时区;要用它初始化状态的页面等 ready 再渲染。
 */
export function useSchoolTz(): { tz: string; ready: boolean } {
  const meta = useQuery({ queryKey: ['meta'], queryFn: schoolApi.meta, staleTime: Infinity })
  return { tz: meta.data?.school_tz ?? localTz(), ready: meta.isSuccess || meta.isError }
}

/** 指定时区里的今天,YYYY-MM-DD */
export const todayIn = (tz: string): string => formatInTz(new Date().toISOString(), tz).slice(0, 10)

/** 指定时区里的本月,YYYY-MM */
export const monthIn = (tz: string): string => todayIn(tz).slice(0, 7)
