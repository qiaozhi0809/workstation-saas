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
/** 任何文字的十进制数字(Unicode Nd),与后端 str.isdecimal() 同范围:全角 ３、阿拉伯文 ٣ 都算,上标 ² / 带圈 ② 不算(L237) */
const ND = /\p{Nd}/u
const isDigit = (c: string) => ND.test(c)
const isCnNumeral = (c: string) => c in CN_DIGIT || c in CN_UNIT

/** 一个 Nd 字符的数值:每种文字的 0–9 连续编码、首个即 0,往前找到这段的开头再取差 */
function digitValue(c: string): number {
  const cp = c.codePointAt(0)!
  let zero = cp
  while (zero > 0 && ND.test(String.fromCodePoint(zero - 1))) zero--
  return (cp - zero) % 10
}

/** 数字段的值:逐位拼十进制,不同文字混写也按位算,与 Python int('1٢') === 12 一致 */
const digitsValue = (run: string) => [...run].reduce((n, c) => n * 10 + digitValue(c), 0)

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

const kindOf = (c: string) => (isDigit(c) ? 'digit' : isCnNumeral(c) ? 'cn' : 'text')

/** 把名字切成数字段 [0, 数值] 与文字段 [1, 原文],末尾加 [-1, 原文] 收尾(保证全序与稳定);按码点切,辅助平面的数字也完整 */
export function classSortKey(name: string): ClassSortKey {
  const chars = [...name]
  const key: ClassSortKey = []
  let i = 0
  while (i < chars.length) {
    const kind = kindOf(chars[i])
    let j = i + 1
    while (j < chars.length && kindOf(chars[j]) === kind) j++
    const run = chars.slice(i, j).join('')
    key.push(
      kind === 'digit' ? [0, digitsValue(run)] : kind === 'cn' ? [0, cnValue(run)] : [1, run],
    )
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
