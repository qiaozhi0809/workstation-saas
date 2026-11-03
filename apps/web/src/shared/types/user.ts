import type { UserBrief } from './admin'

export type User = UserBrief & { login_name?: string }
