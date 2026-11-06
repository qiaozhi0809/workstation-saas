import { useQuery } from '@tanstack/react-query'
import { schoolApi } from '@/shared/api/school'
import { localTz } from '@/shared/lib/time'

/** /meta(校名、学校时区、版本):家长端顶栏与日期显示共用一份缓存(键 ['meta']);校名、时区一个会话里不会变 */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: schoolApi.meta, staleTime: 60 * 60_000 })
}

/** 学校时区(L79):/meta 还没回来或失败时先按浏览器时区显示 */
export function useSchoolTz(): string {
  return useMeta().data?.school_tz ?? localTz()
}
