import type { TagPool } from '@/shared/types/admin'
import { api } from './client'

export const schoolApi = {
  tagPool: () => api<TagPool>('GET', '/school/tag-pool'),
}
