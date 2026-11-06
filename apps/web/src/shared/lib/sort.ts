/**
 * 班名 / 年级名的自然排序(L40):"一二三…十"与阿拉伯数字都按数值比较,
 * 三年二班 < 三年三班 < 三年十班,3班 与 三班 同序;没有数字的名字按原文(码点)比较。
 * 与后端 app/domain/classes/sort.py::class_sort_key 同规则。
 */
export type ClassSortKey = (number | string)[]

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const isAsciiDigit = (c: string) => c >= '0' && c <= '9'
const isCnNumeral = (c: string) => c === '十' || c in CN_DIGIT

/** 含"十"按十进制口语规则(十一 = 11、二十一 = 21);不含"十"按位读(一零一 = 101) */
function cnToNumber(run: string): number {
  if (!run.includes('十')) return Number([...run].map((c) => CN_DIGIT[c]).join(''))
  let total = 0
  let cur = 0
  for (const c of run) {
    if (c === '十') {
      total += (cur || 1) * 10
      cur = 0
    } else cur = CN_DIGIT[c]
  }
  return total + cur
}

export function classSortKey(name: string): ClassSortKey {
  const text = name.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  const key: ClassSortKey = []
  let i = 0
  while (i < text.length) {
    const kind = isAsciiDigit(text[i]) ? 'digit' : isCnNumeral(text[i]) ? 'cn' : 'text'
    let j = i + 1
    while (j < text.length) {
      const k = isAsciiDigit(text[j]) ? 'digit' : isCnNumeral(text[j]) ? 'cn' : 'text'
      if (k !== kind) break
      j++
    }
    const run = text.slice(i, j)
    key.push(kind === 'digit' ? Number(run) : kind === 'cn' ? cnToNumber(run) : run)
    i = j
  }
  return key
}

/** 排序键逐段比较:同为数字比大小,同为文字按原文,数字排在文字前,短的在前 */
export function compareClassName(a: string, b: string): number {
  const ka = classSortKey(a)
  const kb = classSortKey(b)
  const n = Math.min(ka.length, kb.length)
  for (let i = 0; i < n; i++) {
    const x = ka[i]
    const y = kb[i]
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else if (typeof x === 'string' && typeof y === 'string') {
      if (x !== y) return x < y ? -1 : 1
    } else return typeof x === 'number' ? -1 : 1
  }
  return ka.length - kb.length
}
