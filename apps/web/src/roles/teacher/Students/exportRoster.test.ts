import { rosterCsv } from './exportRoster'
import { rec } from './fixtures'

it('writes the 16-column roster csv', () => {
  const csv = rosterCsv([
    rec({
      enrollment_id: 'e1', name: '张三', student_no: '1', gender: '男', birthdate: '2015-03-09', class_role: '班长',
      seat_row: 2, seat_col: 3, tags: ['重点关注', '住校'],
      contacts: [
        { name: '张父', relation: '父亲', phone: '13800000001', job: '' },
        { name: '张母', relation: '母亲', phone: '13800000002', job: '' },
      ],
      family_structure: '双亲家庭', family_note: '无', learning_summary: '良好', personality: '外向', health_notes: '无',
    }),
    rec({ enrollment_id: 'e2', name: '李四', student_no: null, gender: null, birthdate: null, seat_row: null, seat_col: null }),
  ], new Map([['e1', 7]]))
  expect(csv.startsWith('﻿')).toBe(true)
  const lines = csv.slice(1).split('\r\n')
  expect(lines[0]).toBe('学号,姓名,性别,生日,职务,座位,家长姓名,关系,家长电话,家庭结构,家庭备注,学习情况,性格特长,健康情况,标签,积分')
  expect(lines[1]).toBe('1,张三,男,2015-03-09,班长,2-3,张父,父亲,13800000001,双亲家庭,无,良好,外向,无,重点关注、住校,7')
  expect(lines[2]).toBe(',李四,,,,,,,,,,,,,,0')
})

it('leaves points empty without a points map', () => {
  const line = rosterCsv([rec()], null).slice(1).split('\r\n')[1]
  expect(line.endsWith(',')).toBe(true)
})
