import type { ChangePassword } from '@/shared/types/admin'
import type {
  LoginReply,
  LoginResponse,
  PasswordPolicy,
  TotpSetup,
  TotpStatus,
} from '@/shared/types/api'
import type { User } from '@/shared/types/user'
import { api } from './client'

export const authApi = {
  login: (loginName: string, password: string) =>
    api<LoginReply>('POST', '/auth/login', { login_name: loginName, password }),
  loginTotp: (mfaToken: string, code: string) =>
    api<LoginResponse>('POST', '/auth/login/totp', { mfa_token: mfaToken, code }),
  logout: (refreshToken: string) =>
    api<{ ok: boolean }>('POST', '/auth/logout', { refresh_token: refreshToken }),
  me: () => api<User>('GET', '/auth/me'),
  changePassword: (body: ChangePassword) => api<void>('POST', '/auth/password', body),
  passwordPolicy: () => api<PasswordPolicy>('GET', '/auth/password-policy'),
  totpStatus: () => api<TotpStatus>('GET', '/auth/totp'),
  totpSetup: () => api<TotpSetup>('POST', '/auth/totp/setup'),
  totpEnable: (code: string, password: string, refreshToken: string) =>
    api<{ enabled: true }>('POST', '/auth/totp/enable', {
      code,
      password,
      refresh_token: refreshToken,
    }),
  totpDisable: (password: string) =>
    api<{ enabled: false }>('POST', '/auth/totp/disable', { password }),
}
