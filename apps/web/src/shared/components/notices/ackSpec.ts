import type { AckSpec } from '@/shared/types/admin'

export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 5

/**
 * 单选选项的校验文案(L89):AckSettings 的即时提示与提交前的 ackSpecError 用同一份,说法不会打架。
 * 有效选项(去空格后非空)不足 2 个 → "至少要 2 个选项";够了但有空着的 → "选项不能为空";
 * 多于 5 个 → "最多 5 个选项";重复 → "选项不能重复";都没有 → null。
 */
export function optionsError(options: string[]): string | null {
  const trimmed = options.map((o) => o.trim())
  const filled = trimmed.filter(Boolean)
  if (filled.length < MIN_OPTIONS) return `至少要 ${MIN_OPTIONS} 个选项`
  if (filled.length < trimmed.length) return '选项不能为空'
  if (trimmed.length > MAX_OPTIONS) return `最多 ${MAX_OPTIONS} 个选项`
  if (new Set(trimmed).size !== trimmed.length) return '选项不能重复'
  return null
}

/** 发送前校验回执设置:返回第一条错误文案,没有则 null(段 C、D 提交前共用) */
export function ackSpecError(spec: AckSpec, deadline: string | null | undefined): string | null {
  if (spec.kind === 'choice') {
    const bad = optionsError(spec.options)
    if (bad) return bad
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
