import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Context } from '@/shared/types/admin'
import type { User } from '@/shared/types/user'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  lastContext: Context | null
  setTokens: (access: string, refresh: string, user: User) => void
  setUser: (user: User) => void
  setLastContext: (c: Context) => void
  updateAccess: (access: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      lastContext: null,
      setTokens: (accessToken, refreshToken, user) => set({ accessToken, refreshToken, user }),
      setUser: (user) => set({ user }),
      setLastContext: (lastContext) => set({ lastContext }),
      updateAccess: (accessToken) => set({ accessToken }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'ws-auth' },
  ),
)
