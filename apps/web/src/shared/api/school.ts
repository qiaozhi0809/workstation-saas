import type { TagPool } from '@/shared/types/admin'
import type { Grading, Meta, SubjectCatalog } from '@/shared/types/school'
import { api } from './client'

export const schoolApi = {
  tagPool: () => api<TagPool>('GET', '/school/tag-pool'),
  grading: () => api<Grading>('GET', '/school/grading'),
  saveGrading: (grading: Grading) => api<Grading>('PUT', '/admin/settings/grading', grading),
  subjectCatalog: () => api<SubjectCatalog>('GET', '/school/subject-catalog'),
  saveSubjectCatalog: (catalog: SubjectCatalog) =>
    api<SubjectCatalog>('PUT', '/admin/settings/subject-catalog', catalog),
  meta: () => api<Meta>('GET', '/meta'),
}
