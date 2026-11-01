import type { LoginResponse } from '@/shared/types/api'
import type { User } from '@/shared/types/user'
import { api } from './client'

export const authApi = {
  login: (loginName: string, password: string) =>
    api<LoginResponse>('POST', '/auth/login', { login_name: loginName, password }),
  logout: (refreshToken: string) =>
    api<{ ok: boolean }>('POST', '/auth/logout', { refresh_token: refreshToken }),
  me: () => api<User>('GET', '/auth/me'),
}
