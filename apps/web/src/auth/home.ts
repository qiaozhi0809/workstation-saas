import type { Context } from '@/shared/types/admin'
import type { User } from '@/shared/types/user'

const HOME: Record<Context, string> = { teacher: '/teacher', admin: '/admin', parent: '/parent' }

export const contextHome = (c: Context): string => HOME[c]

/** 登录后(及改密码后)去哪:强制改密码 → 上次用的语境(仍在 contexts 里)→ 第一个语境;没有身份 → 登录页 */
export function homeFor(user: Pick<User, 'contexts' | 'must_change_password'>, lastContext: Context | null): string {
  if (user.must_change_password) return '/change-password'
  if (lastContext && user.contexts.includes(lastContext)) return HOME[lastContext]
  const first = user.contexts[0]
  return first ? HOME[first] : '/login'
}
