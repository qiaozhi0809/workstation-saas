import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import LoginPage from '@/auth/LoginPage'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useAuthStore } from '@/shared/stores/auth'

const h = vi.hoisted(() => ({ made: [] as { opts: { onEvent(e: unknown): void } }[] }))
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  createRealtimeClient: (opts: { onEvent(e: unknown): void }) => {
    const c = { opts, start: vi.fn(), stop: vi.fn() }
    h.made.push(c)
    return c
  },
}))
import { RealtimeProvider } from './RealtimeProvider'

it('真实路由下 session.revoked 后登录页显示停用提示', async () => {
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r',
    user: { id: 'u', display_name: 'x', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
  const router = createMemoryRouter([
    { path: '/teacher', element: <ProtectedRoute context="teacher"><RealtimeProvider><div>home</div></RealtimeProvider></ProtectedRoute> },
    { path: '/login', element: <LoginPage /> },
  ], { initialEntries: ['/teacher'] })
  render(<RouterProvider router={router} />)
  expect(screen.getByText('home')).toBeInTheDocument()
  await act(async () => {
    h.made[0].opts.onEvent({ type: 'session.revoked' })
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(router.state.location.pathname).toBe('/login')
  expect(screen.getByText('你的账号已被停用')).toBeInTheDocument()
})
