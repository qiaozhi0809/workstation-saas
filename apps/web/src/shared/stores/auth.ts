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
    {
      name: 'ws-auth',
      version: 1,
      // v0 存档的 user 没有 contexts/admin_perms:清掉登录态,强制重登
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<AuthState>
        if (version < 1)
          return { ...s, accessToken: null, refreshToken: null, user: null } as AuthState
        return s as AuthState
      },
    },
  ),
)
