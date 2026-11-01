import type { Preferences } from '@/shared/types/preferences'
import { api } from './client'

export const preferencesApi = {
  get: () => api<Preferences>('GET', '/me/preferences'),
  save: (prefs: Preferences) => api<Preferences>('PUT', '/me/preferences', prefs),
}
