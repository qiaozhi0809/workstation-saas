const hex = (b: number) => b.toString(16).padStart(2, '0')

/**
 * 一次操作的 op_id(RFC 4122 v4 UUID)。crypto.randomUUID 只在安全上下文(HTTPS / localhost)里有,
 * 学校内网走纯 HTTP 时没有,这时用 crypto.getRandomValues 自己拼。
 */
export function newOpId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // 版本 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 变体
  const h = Array.from(b, hex).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
