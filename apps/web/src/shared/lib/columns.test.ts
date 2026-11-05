import {
  cleanHeader,
  matchColumns,
  STUDENT_COLUMNS,
  FAMILY_TYPES,
  normalizeBirthday,
  toImportRows,
  STUDENT_TEMPLATE_CSV,
  matchScoreColumns,
  findStudent,
} from './columns'
import { parseTable } from './table'
import type { StudentSeat } from '@/shared/types/student'

const seat = (name: string, no: string | null, id = name + no): StudentSeat => ({
  enrollment_id: 'e' + id,
  student_id: 's' + id,
  name,
  mk: 'mk',
  seat_row: null,
  seat_col: null,
  avatar_seed: null,
  gender: null,
  student_no: no,
  birthdate: null,
  class_role: null,
  seat_locked: false,
})

describe('cleanHeader', () => {
  it('removes bracketed content, whitespace, asterisks and colons', () => {
    expect(cleanHeader(' 性别(男/女) ')).toBe('性别')
    expect(cleanHeader('姓名（必填）*')).toBe('姓名')
    expect(cleanHeader('学 号：')).toBe('学号')
    expect(cleanHeader('电话:')).toBe('电话')
  })
})

describe('matchColumns', () => {
  it('matches student headers exactly first, then by prefix', () => {
    expect(matchColumns(['性别(男/女)', '家长电话1', '姓名'], STUDENT_COLUMNS)).toEqual({
      gender: 0,
      p0phone: 1,
      name: 2,
    })
  })
  it('lets exact matches win over prefix matches and gives each column one key', () => {
    const r = matchColumns(['家长', '家长姓名'], STUDENT_COLUMNS)
    expect(r.p0name).toBe(0)
    expect(Object.values(r)).toEqual([0])
  })
  it('gives each key to the first matching column', () => {
    expect(matchColumns(['姓名', '名字'], STUDENT_COLUMNS)).toEqual({ name: 0 })
  })
})

describe('normalizeBirthday', () => {
  it('normalises separators and pads', () => {
    expect(normalizeBirthday('2012/5/6')).toBe('2012-05-06')
    expect(normalizeBirthday('2012.5.6')).toBe('2012-05-06')
    expect(normalizeBirthday('2012年5月6日')).toBe('2012-05-06')
    expect(normalizeBirthday('2012-05-06')).toBe('2012-05-06')
  })
  it('rejects non-dates', () => {
    expect(normalizeBirthday('2012-02-30')).toBeNull()
    expect(normalizeBirthday('2013-02-29')).toBeNull()
    expect(normalizeBirthday('hello')).toBeNull()
    expect(normalizeBirthday('2012年5月')).toBeNull()
    expect(normalizeBirthday('')).toBeNull()
  })
  it('accepts a real leap day', () => {
    expect(normalizeBirthday('2012-02-29')).toBe('2012-02-29')
  })
})

describe('toImportRows', () => {
  it('normalises birthdays and genders, and keeps unknown family text as a note', () => {
    const t = [
      ['姓名', '性别', '生日', '家庭结构', '家庭备注'],
      ['李一', 'F', '2012/5/6', '寄养', '住亲戚家'],
      ['李二', '男', '2012年5月6日', '单亲家庭', ''],
      ['李三', '', '2012-02-30', '', ''],
    ]
    const { rows, missingName } = toImportRows(t)
    expect(missingName).toBe(false)
    expect(rows[0].gender).toBe('女')
    expect(rows[0].birthdate).toBe('2012-05-06')
    expect(rows[0].family_structure).toBe('其他')
    expect(rows[0].family_note?.startsWith('寄养')).toBe(true)
    expect(rows[0].family_note).toContain('住亲戚家')
    expect(rows[1].gender).toBe('男')
    expect(rows[1].birthdate).toBe('2012-05-06')
    expect(rows[1].family_structure).toBe('单亲家庭')
    expect(rows[1].family_note).toBeNull()
    expect(rows[2].gender).toBeNull()
    expect(rows[2].birthdate).toBeNull()
    expect(rows[2].family_structure).toBeNull()
  })
  it('keeps unknown family text as the note when there is no note column', () => {
    const { rows } = toImportRows([
      ['姓名', '家庭结构'],
      ['甲', '寄养'],
    ])
    expect(rows[0].family_structure).toBe('其他')
    expect(rows[0].family_note).toBe('寄养')
  })
  it('treats any non-empty, non-female gender as male', () => {
    const { rows } = toImportRows([
      ['姓名', '性别'],
      ['甲', '女生'],
      ['乙', 'x'],
      ['丙', 'f'],
    ])
    expect(rows.map((r) => r.gender)).toEqual(['女', '男', '女'])
  })
  it('reports a missing name column', () => {
    const r = toImportRows([
      ['学号', '性别'],
      ['01', '男'],
    ])
    expect(r.missingName).toBe(true)
    expect(r.rows).toEqual([])
  })
  it('handles an empty table', () => {
    expect(toImportRows([])).toEqual({ rows: [], columns: [], missingName: true })
  })
  it('skips rows with a blank name', () => {
    const { rows } = toImportRows([
      ['姓名', '学号'],
      ['甲', '01'],
      ['', '02'],
      ['乙', '03'],
    ])
    expect(rows.map((r) => r.name)).toEqual(['甲', '乙'])
  })
  it('fills a complete StudentInput shape with nulls for unmapped fields', () => {
    const { rows, columns } = toImportRows([['姓名'], ['甲']])
    expect(columns).toEqual(['name'])
    expect(rows[0]).toEqual({
      name: '甲',
      gender: null,
      student_no: null,
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
      contacts: [],
    })
  })
  it('maps student_no, role, and a single contact group', () => {
    const { rows } = toImportRows([
      ['姓名', '学号', '职务', '家长姓名', '关系', '家长电话'],
      ['甲', '', '班长', '甲父', '父亲', '13800000001'],
      ['乙', '02', '', '', '', ''],
    ])
    expect(rows[0].student_no).toBeNull()
    expect(rows[0].class_role).toBe('班长')
    expect(rows[0].contacts).toEqual([
      { name: '甲父', relation: '父亲', phone: '13800000001', job: '' },
    ])
    expect(rows[1].student_no).toBe('02')
    expect(rows[1].class_role).toBeNull()
    expect(rows[1].contacts).toEqual([])
  })
  it('drops a contact that has only a relation (server needs name or phone)', () => {
    const { rows } = toImportRows([
      ['姓名', '关系'],
      ['甲', '父亲'],
    ])
    expect(rows[0].contacts).toEqual([])
  })
  it('round-trips the template through parseTable', () => {
    const { rows, missingName, columns } = toImportRows(parseTable(STUDENT_TEMPLATE_CSV))
    expect(missingName).toBe(false)
    expect(columns).toEqual([
      'name',
      'gender',
      'no',
      'birthday',
      'role',
      'p0name',
      'p0rel',
      'p0phone',
      'family',
      'note',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: '张三',
      gender: '男',
      student_no: '01',
      birthdate: '2012-05-06',
      class_role: null,
      family_structure: '双亲家庭',
      note: null,
      contacts: [{ name: '张建国', relation: '父亲', phone: '13800000000', job: '' }],
    })
  })
})

describe('constants', () => {
  it('exposes the family types and template header', () => {
    expect(FAMILY_TYPES).toEqual([
      '双亲家庭',
      '单亲家庭',
      '重组家庭',
      '隔代抚养',
      '父母在外务工',
      '其他',
    ])
    expect(STUDENT_TEMPLATE_CSV.split('\n')[0]).toBe(
      '姓名,性别,学号,生日,职务,家长姓名,关系,家长电话,家庭结构,备注',
    )
    expect(STUDENT_TEMPLATE_CSV).toContain(
      '张三,男,01,2012-05-06,,张建国,父亲,13800000000,双亲家庭,',
    )
  })
})

describe('matchScoreColumns', () => {
  it('matches score columns only by exact subject name', () => {
    expect(
      matchScoreColumns(
        ['学号', '名字', '语文', '数学(满分)', '英语成绩'],
        ['语文', '数学', '英语'],
      ),
    ).toEqual({ no: 0, name: 1, subjects: { 语文: 2, 数学: 3 } })
  })
  it('strips mixed ASCII/full-width brackets from headers', () => {
    expect(cleanHeader('数学(满分）')).toBe('数学')
    expect(cleanHeader('数学（满分)')).toBe('数学')
    expect(matchScoreColumns(['姓名', '数学(满分）'], ['数学'])).toEqual({
      name: 0,
      subjects: { 数学: 1 },
    })
  })
  it('returns empty subjects when nothing matches', () => {
    expect(matchScoreColumns(['x'], ['语文'])).toEqual({ subjects: {} })
  })
})

describe('findStudent', () => {
  const roster = [seat('王芳', '01'), seat('王芳', '02'), seat('李明', '03')]
  it('refuses to guess between duplicate names', () => {
    expect(findStudent(roster, '王芳', '')).toBeNull()
    expect(findStudent(roster, '王芳', '02')?.student_no).toBe('02')
  })
  it('matches a unique name', () => {
    expect(findStudent(roster, '李明', '')?.student_no).toBe('03')
    expect(findStudent(roster, ' 李明 ', '')?.student_no).toBe('03')
  })
  it('prefers the student number over the name', () => {
    expect(findStudent(roster, '李明', '01')?.student_no).toBe('01')
  })
  it('falls back to the name when the number matches nobody, and returns null for unknowns', () => {
    expect(findStudent(roster, '李明', '99')?.student_no).toBe('03')
    expect(findStudent(roster, '路人', '')).toBeNull()
  })
})
