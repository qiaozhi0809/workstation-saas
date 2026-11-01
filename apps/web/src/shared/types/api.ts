import type { User } from './user'

export interface ListResponse<T> { items: T[] }

export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_at: string
  user: User
}
