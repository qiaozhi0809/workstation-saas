import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { ExamInput } from '@/shared/types/grades'
import type { StudentImport, StudentInput } from '@/shared/types/student'
import { examsApi } from './exams'
import { studentsApi } from './students'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: 'x',
      contexts: ['teacher'],
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    },
  })
})

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0]
  return {
    method: init.method,
    url,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  }
}

const examInput: ExamInput = {
  name: '期中',
  exam_type: '期中',
  date: '2026-11-02',
  subjects: [{ name: '语文', full: 120 }],
}
const studentInput: StudentInput = {
  name: '甲',
  gender: '男',
  student_no: '01',
  birthdate: null,
  class_role: null,
  tags: [],
  boarding: false,
  family_structure: null,
  family_note: null,
  learning_summary: null,
  personality: null,
  note: null,
  health_notes: null,
  contacts: [{ name: '乙', relation: '父', phone: '13800000001', job: '' }],
  seat: null,
}
const row: Omit<StudentInput, 'seat'> = { ...studentInput }
delete (row as Partial<StudentInput>).seat
const importBody: StudentImport = { rows: [row], auto_seat: true }

const C = '/api/v1/classes/c1'
const calls: [string, () => Promise<unknown>, string, string, unknown][] = [
  ['subjects', () => examsApi.subjects('c1'), 'GET', `${C}/subjects`, undefined],
  ['exams', () => examsApi.list('c1'), 'GET', `${C}/exams`, undefined],
  ['create exam', () => examsApi.create('c1', examInput), 'POST', `${C}/exams`, examInput],
  ['update exam', () => examsApi.update('c1', 'e1', examInput), 'PUT', `${C}/exams/e1`, examInput],
  ['remove exam', () => examsApi.remove('c1', 'e1'), 'DELETE', `${C}/exams/e1`, undefined],
  ['sheet', () => examsApi.sheet('c1', 'e1'), 'GET', `${C}/exams/e1/scores`, undefined],
  [
    'export sheet',
    () => examsApi.exportSheet('c1', 'e1'),
    'GET',
    `${C}/exams/e1/export`,
    undefined,
  ],
  ['gradebook', () => examsApi.gradebook('c1'), 'GET', `${C}/gradebook`, undefined],
  ['records', () => studentsApi.records('c1'), 'GET', `${C}/students/records`, undefined],
  [
    'create student',
    () => studentsApi.create('c1', studentInput),
    'POST',
    `${C}/students`,
    studentInput,
  ],
  [
    'update student',
    () => studentsApi.update('c1', 'n1', studentInput),
    'PUT',
    `${C}/students/n1`,
    studentInput,
  ],
  ['remove student', () => studentsApi.remove('c1', 'n1'), 'DELETE', `${C}/students/n1`, undefined],
  [
    'import',
    () => studentsApi.importRows('c1', importBody),
    'POST',
    `${C}/students/import`,
    importBody,
  ],
  [
    'export students',
    () => studentsApi.exportRecords('c1'),
    'GET',
    `${C}/students/export`,
    undefined,
  ],
]

it.each(calls)('%s calls the frozen endpoint', async (_n, call, method, url, body) => {
  fetchMock.mockResolvedValue(
    new Response(method === 'DELETE' ? null : '{}', {
      status: method === 'DELETE' ? 204 : 200,
    }),
  )
  await call()
  expect(lastCall()).toEqual({ method, url, body })
})

it('saves score cells as {cells}', async () => {
  await examsApi.saveScores('c1', 'e1', [{ enrollment_id: 'n1', subject: '语文', value: 'absent' }])
  expect(lastCall()).toEqual({
    method: 'PUT',
    url: '/api/v1/classes/c1/exams/e1/scores',
    body: { cells: [{ enrollment_id: 'n1', subject: '语文', value: 'absent' }] },
  })
})

it('encodes ids in student paths', async () => {
  await studentsApi.update('c/1', 'n 1', studentInput)
  expect(lastCall().url).toBe('/api/v1/classes/c%2F1/students/n%201')
})

it('encodes ids in exam paths', async () => {
  await examsApi.sheet('c/1', 'e 1')
  expect(lastCall().url).toBe('/api/v1/classes/c%2F1/exams/e%201/scores')
})

it('posts my notes as {text}', async () => {
  await studentsApi.saveMyNotes('s1', 'x')
  expect(lastCall()).toEqual({
    method: 'PUT',
    url: '/api/v1/students/s1/my-notes',
    body: { text: 'x' },
  })
})
