import type { User } from './user'

export interface ListResponse<T> {
  items: T[]
}

export interface MfaChallenge {
  mfa_required: true
  mfa_token: string
  expires_in: number
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_at: string
  user: User
}

export type LoginReply = LoginResponse | MfaChallenge

export const isMfaChallenge = (r: LoginReply): r is MfaChallenge =>
  'mfa_required' in r && r.mfa_required === true

export interface PasswordPolicy {
  min_length: number
  max_age_days: number
}

export interface TotpStatus {
  allowed: boolean
  enabled: boolean
  enabled_at: string | null
}

export interface TotpSetup {
  secret: string
  otpauth_uri: string
  qr_svg: string
}
