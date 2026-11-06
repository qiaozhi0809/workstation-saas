import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'

/** m5d-common 约定的 /meta 查询键;家长端顶栏、管理端日期、关于对话框共用同一份缓存 */
export const META_QUERY_KEY = ['meta'] as const

/**
 * /meta(校名、学校时区、版本):校名、时区一个会话里不会变,1 小时内不重取。
 * enabled 为假时不发请求(关于对话框只在打开时取)。
 */
export function useMeta({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: META_QUERY_KEY,
    queryFn: schoolApi.meta,
    staleTime: 60 * 60_000,
    enabled,
  })
}

/** Intl 认得的时区名才算合法(空串不算);不合法返回 null,免得 formatInTz 抛 RangeError(与 LiveWatermark 的 L172 同一做法) */
function validTz(tz: string | undefined): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/**
 * 学校时区(L43 / L79 / L134):后端按它算日界,前端"今天 / 本月"的默认值与时间显示也按它算。
 * ready 为假时 /meta 还没回来,tz 先退回浏览器时区;要用它初始化状态的页面等 ready 再渲染。
 * /meta 失败或给了不合法的时区名时 ready 为真、tz 为浏览器时区,页面照常可用。
 */
export function useSchoolTz(): { tz: string; ready: boolean } {
  const meta = useMeta()
  return { tz: validTz(meta.data?.school_tz) ?? localTz(), ready: meta.isSuccess || meta.isError }
}

/** 指定时区里的今天,YYYY-MM-DD;时区名不合法时按浏览器时区算,不抛错 */
export function todayIn(tz: string): string {
  const now = new Date().toISOString()
  try {
    return formatInTz(now, tz).slice(0, 10)
  } catch {
    return formatInTz(now, localTz()).slice(0, 10)
  }
}

/** 指定时区里的本月,YYYY-MM */
export const monthIn = (tz: string): string => todayIn(tz).slice(0, 7)
