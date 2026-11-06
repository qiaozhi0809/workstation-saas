import type {
  ClassTimetable,
  Period,
  TimetableCellInput,
  TimetableImportResult,
} from '@/shared/types/timetable'
import { api } from './client'

export const timetableApi = {
  periods: () => api<Period[]>('GET', '/periods'),
  savePeriods: (periods: Period[]) => api<Period[]>('PUT', '/admin/periods', { periods }),
  classTimetable: (classId: string) => api<ClassTimetable>('GET', `/classes/${classId}/timetable`),
  saveClassTimetable: (classId: string, cells: TimetableCellInput[]) =>
    api<ClassTimetable>('PUT', `/admin/classes/${classId}/timetable`, { cells }),
  importCsv: (file: File) =>
    api<TimetableImportResult>('POST', '/admin/timetable/import', undefined, {
      raw: file,
      headers: { 'Content-Type': 'text/csv' },
    }),
}
