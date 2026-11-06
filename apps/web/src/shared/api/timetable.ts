import { useAuthStore } from '@/shared/stores/auth'
import type {
  ClassTimetable,
  Period,
  TimetableCellInput,
  TimetableImportResult,
} from '@/shared/types/timetable'
import { API_BASE, ApiError, api, toApiError, tryRefreshAccessToken } from './client'

function sessionExpired(): ApiError {
  useAuthStore.getState().logout()
  return new ApiError(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
}

/** CSV 要以 text/csv 原样上传:共用的 authedFetch 会把 body 当 JSON 序列化,所以这里单独发请求,
 * 并照搬它的 401 处理(刷新一次再重发;被拒则登出)。 */
async function postCsv(path: string, body: Blob): Promise<Response> {
  const send = () => {
    const { accessToken } = useAuthStore.getState()
    const headers: Record<string, string> = { 'Content-Type': 'text/csv' }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    return fetch(`${API_BASE}${path}`, { method: 'POST', headers, body })
  }
  let res = await send()
  if (res.status === 401) {
    const refreshed = await tryRefreshAccessToken()
    if (refreshed === 'network') return res // 保留登录态,按原 401 失败
    if (refreshed !== 'ok') throw sessionExpired()
    res = await send()
    if (res.status === 401) throw sessionExpired()
  }
  return res
}

export const timetableApi = {
  periods: () => api<Period[]>('GET', '/periods'),
  savePeriods: (periods: Period[]) => api<Period[]>('PUT', '/admin/periods', { periods }),
  classTimetable: (classId: string) => api<ClassTimetable>('GET', `/classes/${classId}/timetable`),
  saveClassTimetable: (classId: string, cells: TimetableCellInput[]) =>
    api<ClassTimetable>('PUT', `/admin/classes/${classId}/timetable`, { cells }),
  async importCsv(file: File): Promise<TimetableImportResult> {
    const res = await postCsv('/admin/timetable/import', file)
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as TimetableImportResult
  },
}
