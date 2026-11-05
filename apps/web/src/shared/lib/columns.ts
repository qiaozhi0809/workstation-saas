import type { Contact, StudentImport, StudentSeat } from '@/shared/types/student'

export function cleanHeader(h: string): string {
  return h.replace(/[(（][^)）]*[)）]/g, '').replace(/[\s*:：]/g, '')
}

type Spec<K extends string> = readonly (readonly [K, readonly string[]])[]

export function matchColumns<K extends string>(
  headers: string[],
  spec: Spec<K>,
): Partial<Record<K, number>> {
  const cleaned = headers.map(cleanHeader)
  const result: Partial<Record<K, number>> = {}
  const used = new Set<number>()
  for (const [key, aliases] of spec) {
    const idx = cleaned.findIndex((h, i) => !used.has(i) && h !== '' && aliases.includes(h))
    if (idx >= 0) {
      result[key] = idx
      used.add(idx)
    }
  }
  cleaned.forEach((h, i) => {
    if (used.has(i) || h === '') return
    let best: K | null = null
    let bestLen = 0
    for (const [key, aliases] of spec) {
      if (result[key] !== undefined) continue
      for (const a of aliases) {
        if (h.startsWith(a) && a.length > bestLen) {
          best = key
          bestLen = a.length
        }
      }
    }
    if (best !== null) {
      result[best] = i
      used.add(i)
    }
  })
  return result
}

export const STUDENT_COLUMNS = [
  ['name', ['姓名', '名字', '学生姓名']],
  ['gender', ['性别']],
  ['no', ['学号', '编号']],
  ['birthday', ['生日', '出生日期', '出生年月']],
  ['role', ['职务', '班干部']],
  ['p0name', ['家长姓名', '家长', '联系人', '监护人']],
  ['p0rel', ['关系', '家长关系']],
  ['p0phone', ['家长电话', '联系电话', '电话', '手机']],
  ['family', ['家庭结构', '家庭情况']],
  ['familyNote', ['家庭备注']],
  ['study', ['学习情况']],
  ['personality', ['性格', '性格特长']],
  ['health', ['健康', '健康情况']],
  ['note', ['备注', '其他备注']],
] as const

export const FAMILY_TYPES = [
  '双亲家庭',
  '单亲家庭',
  '重组家庭',
  '隔代抚养',
  '父母在外务工',
  '其他',
] as const

export function normalizeBirthday(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/[/.年月]/g, '-')
    .replace(/日/g, '')
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function toImportRows(table: string[][]): {
  rows: StudentImport['rows']
  columns: string[]
  missingName: boolean
} {
  if (table.length === 0) return { rows: [], columns: [], missingName: true }
  const map = matchColumns(table[0], STUDENT_COLUMNS)
  const columns = (Object.entries(map) as [string, number][])
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k)
  if (map.name === undefined) return { rows: [], columns, missingName: true }
  const rows: StudentImport['rows'] = []
  for (const r of table.slice(1)) {
    const get = (k: (typeof STUDENT_COLUMNS)[number][0]): string => {
      const i = map[k]
      return i === undefined ? '' : (r[i] ?? '').trim()
    }
    const orNull = (k: (typeof STUDENT_COLUMNS)[number][0]) => get(k) || null
    const name = get('name')
    if (!name) continue
    const g = get('gender')
    const fam = get('family')
    let familyStructure: string | null = null
    let familyNote = orNull('familyNote')
    if (fam) {
      if ((FAMILY_TYPES as readonly string[]).includes(fam)) familyStructure = fam
      else {
        familyStructure = '其他'
        familyNote = familyNote ? `${fam}；${familyNote}` : fam
      }
    }
    const contact: Contact = {
      name: get('p0name'),
      relation: get('p0rel'),
      phone: get('p0phone'),
      job: '',
    }
    rows.push({
      name,
      gender: g ? (/女|f/i.test(g) ? '女' : '男') : null,
      student_no: orNull('no'),
      birthdate: get('birthday') ? normalizeBirthday(get('birthday')) : null,
      class_role: orNull('role'),
      tags: [],
      boarding: false,
      family_structure: familyStructure,
      family_note: familyNote,
      learning_summary: orNull('study'),
      personality: orNull('personality'),
      note: orNull('note'),
      health_notes: orNull('health'),
      // 服务端要求联系人姓名与电话不能同时为空,只填了关系的整行会让整批导入 400
      contacts: contact.name || contact.phone ? [contact] : [],
    })
  }
  return { rows, columns, missingName: false }
}

export const STUDENT_TEMPLATE_CSV =
  '姓名,性别,学号,生日,职务,家长姓名,关系,家长电话,家庭结构,备注\n张三,男,01,2012-05-06,,张建国,父亲,13800000000,双亲家庭,\n'

const SCORE_ID_COLUMNS = [
  ['name', ['姓名', '名字']],
  ['no', ['学号']],
] as const

export function matchScoreColumns(
  headers: string[],
  subjects: string[],
): { name?: number; no?: number; subjects: Record<string, number> } {
  const base = matchColumns(headers, SCORE_ID_COLUMNS)
  const out: { name?: number; no?: number; subjects: Record<string, number> } = { subjects: {} }
  if (base.name !== undefined) out.name = base.name
  if (base.no !== undefined) out.no = base.no
  const cleaned = headers.map(cleanHeader)
  for (const s of subjects) {
    const i = cleaned.findIndex((h, idx) => h === s && idx !== base.name && idx !== base.no)
    if (i >= 0) out.subjects[s] = i
  }
  return out
}

export function findStudent(roster: StudentSeat[], name: string, no: string): StudentSeat | null {
  const n = no.trim()
  if (n) {
    const byNo = roster.find((s) => s.student_no === n)
    if (byNo) return byNo
  }
  const nm = name.trim()
  const byName = roster.filter((s) => s.name === nm)
  return byName.length === 1 ? byName[0] : null
}
