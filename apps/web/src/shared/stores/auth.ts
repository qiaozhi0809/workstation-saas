import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/shared/types/user'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  setTokens: (access: string, refresh: string, user: User) => void
  updateAccess: (access: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (accessToken, refreshToken, user) => set({ accessToken, refreshToken, user }),
      updateAccess: (accessToken) => set({ accessToken }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'ws-auth' },
  ),
)
