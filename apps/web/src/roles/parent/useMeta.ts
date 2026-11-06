import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { localTz } from '@/shared/lib/time'

/** /meta(校名、学校时区、版本):家长端顶栏与日期显示共用一份缓存(键 ['meta']);校名、时区一个会话里不会变 */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: schoolApi.meta, staleTime: 60 * 60_000 })
}

/** 不是 Intl 认得的时区名(含空串)就回落浏览器时区,免得 formatInTz 抛 RangeError;与 LiveWatermark 的 L172 同一做法 */
function validTz(tz: string | undefined): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/** 学校时区(L79):/meta 还没回来、失败或给了不合法的值时按浏览器时区显示 */
export function useSchoolTz(): string {
  return validTz(useMeta().data?.school_tz) ?? localTz()
}
