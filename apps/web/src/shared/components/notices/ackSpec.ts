import type { AckSpec } from '@/shared/types/admin'

/** 发送前校验回执设置:返回第一条错误文案,没有则 null(段 C、D 提交前共用) */
export function ackSpecError(spec: AckSpec, deadline: string | null | undefined): string | null {
  if (spec.kind === 'choice') {
    const opts = spec.options.map((o) => o.trim())
    if (opts.length < 2 || opts.length > 5 || opts.some((o) => o === '')) return '至少要 2 个选项'
    if (new Set(opts).size !== opts.length) return '选项不能重复'
  }
  if (spec.kind !== 'none' && deadline && new Date(deadline).getTime() <= Date.now()) {
    return '截止时间要晚于现在'
  }
  return null
}

/** 提交用:选项去首尾空格;"不要回执"不带截止时间 */
export function normalizeAck(
  spec: AckSpec,
  deadline: string | null | undefined,
): { ack: AckSpec; ack_deadline: string | null } {
  if (spec.kind === 'none') return { ack: spec, ack_deadline: null }
  const ack: AckSpec =
    spec.kind === 'choice' ? { ...spec, options: spec.options.map((o) => o.trim()) } : spec
  return { ack, ack_deadline: deadline ?? null }
}
