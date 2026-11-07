import type { Onboarded, Preferences } from '@/shared/types/preferences'
import { api } from './client'

/**
 * 偏好 + 首次引导状态(M5d R7)。Onboarded 只在 shared/types/preferences.ts 定义一份(L240)。
 * GET 总返回完整 onboarded;旧后端没有这个字段(此时欢迎页一律不弹)。
 * PUT 发偏好整体:onboarded 省略 = 不动;给了就按键合并,键只能是自己拥有的语境,否则 400——
 * 所以写的时候只带要标记的那一个键,不要把 GET 回来的 onboarded 原样发回去。
 */
export interface PreferencesWithOnboarded extends Preferences {
  onboarded?: Onboarded
}

export const preferencesApi = {
  get: () => api<PreferencesWithOnboarded>('GET', '/me/preferences'),
  save: (prefs: PreferencesWithOnboarded) =>
    api<PreferencesWithOnboarded>('PUT', '/me/preferences', prefs),
}
