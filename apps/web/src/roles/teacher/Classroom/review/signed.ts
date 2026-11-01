/** 分值带符号显示:正数 +N,负数 -N。 */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
