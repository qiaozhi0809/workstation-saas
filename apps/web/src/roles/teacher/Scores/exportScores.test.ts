import { beforeEach, expect, it, vi } from 'vitest'
import { examsApi } from '@/shared/api/exams'
import { toast } from '@/shared/components/Toast'
import { downloadText } from '@/shared/lib/csv'
import type { Exam, ScoreSheet } from '@/shared/types/grades'
import type { StudentSeat } from '@/shared/types/student'
import { exportScores, scoresCsv } from './exportScores'

vi.mock('@/shared/api/exams')
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/shared/lib/csv')>()), downloadText: vi.fn() }))

const exam: Exam = {
  id: 'x1', name: '十月月考', exam_type: '月考', date: '2026-10-20',
  subjects: [{ name: '语文', full: 100 }, { name: '数学', full: 100 }],
  created_by_me: true, progress: { entered: 3, total: 4 },
}
const seat = (n: number, name: string, no: string | null): StudentSeat => ({
  enrollment_id: `e${n}`, student_id: `s${n}`, name, mk: `S${n}`, seat_row: null, seat_col: null,
  avatar_seed: null, gender: null, student_no: no, birthdate: null, class_role: null, seat_locked: false,
})
const roster = [seat(1, '王小一', '01'), seat(2, '李小二', '02'), seat(3, '张小三', '03'), seat(4, '赵小四', '04')]
const sheet: ScoreSheet = {
  exam,
  items: [
    { enrollment_id: 'e1', scores: { 语文: 80, 数学: null } },
    { enrollment_id: 'e2', scores: { 语文: 90, 数学: 85 } },
    { enrollment_id: 'e3', scores: { 语文: null, 数学: null } },
    { enrollment_id: 'eX', scores: { 语文: 99, 数学: 99 } },
  ],
}

beforeEach(() => { vi.resetAllMocks() })

it('writes scores csv with absent marks, totals and ranks', () => {
  const lines = scoresCsv(exam, sheet, roster).split('\r\n')
  expect(lines[0]).toBe('﻿学号,姓名,语文,数学,总分,排名')
  expect(lines[1]).toBe('02,李小二,90,85,175,1')
  expect(lines[2]).toBe('01,王小一,80,缺考,80,2')
  // 全缺考排最后、排名空;未录入的人也在,科目为空;不在名单里的 eX 不出现
  expect(lines[3]).toBe('03,张小三,缺考,缺考,,')
  expect(lines[4]).toBe('04,赵小四,,,,')
  expect(lines).toHaveLength(5)
})

it('exports through exportSheet and downloads with the class and exam name', async () => {
  vi.mocked(examsApi.exportSheet).mockResolvedValue(sheet)
  await exportScores('c1', '三年二班', exam, roster)
  expect(examsApi.exportSheet).toHaveBeenCalledWith('c1', 'x1')
  expect(downloadText).toHaveBeenCalledWith('三年二班-十月月考-成绩.csv', expect.stringContaining('李小二,90,85,175,1'))
})

it('toasts when export fails', async () => {
  vi.mocked(examsApi.exportSheet).mockRejectedValue(new Error('boom'))
  await exportScores('c1', '三年二班', exam, roster)
  expect(downloadText).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('导出失败,请重试')
})

it('orders students by numeric student number', () => {
  const r = [seat(1, '王小一', '10'), seat(2, '李小二', '2'), seat(3, '张小三', '1')]
  const sh: ScoreSheet = { exam, items: [] }
  const lines = scoresCsv(exam, sh, r).split('\r\n')
  expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '2', '10'])
})
