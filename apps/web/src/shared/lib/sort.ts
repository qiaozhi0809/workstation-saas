/**
 * 班名 / 年级名的自然排序(L40):"一二三…十百"与阿拉伯数字都按数值比较,
 * 三年二班 < 三年三班 < 三年十班,3班 与 三班 同序;没有数字的名字按原文(码点)比较。
 * 与后端 app/domain/classes/sort.py::class_sort_key 同规则、同用例。
 */

/** 一段 = [种类, 值]:0 数字段、1 文字段、-1 收尾段(原文);同一位置先比种类再比值 */
export type ClassSortSegment = [0, number] | [1, string] | [-1, string]
export type ClassSortKey = ClassSortSegment[]

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100 }
const isAsciiDigit = (c: string) => c >= '0' && c <= '9'
const isCnNumeral = (c: string) => c in CN_DIGIT || c in CN_UNIT

/** 中文数字的值:二十一 → 21、十 → 10、一百零一 → 101;连写的数字(一二)按位拼成 12 */
function cnValue(run: string): number {
  let total = 0
  let num = 0
  for (const c of run) {
    if (c in CN_UNIT) {
      total += (num || 1) * CN_UNIT[c]
      num = 0
    } else num = num * 10 + CN_DIGIT[c]
  }
  return total + num
}

/** 把名字切成数字段 [0, 数值] 与文字段 [1, 原文],末尾加 [-1, 原文] 收尾(保证全序与稳定) */
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
    key.push(kind === 'digit' ? [0, Number(run)] : kind === 'cn' ? [0, cnValue(run)] : [1, run])
    i = j
  }
  key.push([-1, name])
  return key
}

/** 排序键逐段比较:先比种类(收尾 < 数字 < 文字),再比值;所以 高一 < 高一1班,3班 与 三班 按原文分先后 */
export function compareClassName(a: string, b: string): number {
  const ka = classSortKey(a)
  const kb = classSortKey(b)
  const n = Math.min(ka.length, kb.length)
  for (let i = 0; i < n; i++) {
    const [kx, x] = ka[i]
    const [ky, y] = kb[i]
    if (kx !== ky) return kx - ky
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return x < y ? -1 : 1
  }
  return ka.length - kb.length
}
