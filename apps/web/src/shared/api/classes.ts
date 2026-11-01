import type { ListResponse } from '@/shared/types/api'
import type { ClassView } from '@/shared/types/class'
import { api } from './client'

export const classesApi = {
  mine: () => api<ListResponse<ClassView>>('GET', '/me/classes'),
}
