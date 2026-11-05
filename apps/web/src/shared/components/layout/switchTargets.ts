import type { Context } from '@/shared/types/admin'

const LABEL: Record<Context, { label: string; to: string }> = {
  teacher: { label: '切换到教师端', to: '/teacher' },
  admin: { label: '切换到管理端', to: '/admin' },
  parent: { label: '切换到家长端', to: '/parent' },
}
const ORDER: Context[] = ['teacher', 'admin', 'parent']

/** 账号菜单里的"切换到…":除当前语境外账号拥有的全部语境 */
export function switchTargets(contexts: Context[] | undefined, current: Context) {
  return ORDER.filter((c) => c !== current && contexts?.includes(c)).map((c) => ({
    ...LABEL[c],
    context: c,
  }))
}
