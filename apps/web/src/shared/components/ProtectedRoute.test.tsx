import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import ProtectedRoute from './ProtectedRoute'

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute>
              <div>secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => useAuthStore.getState().logout())
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('redirects to /login without a token', () => {
  renderApp()
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(screen.queryByText('secret')).not.toBeInTheDocument()
})

it('renders children with a token', () => {
  useAuthStore.getState().setTokens('a', 'r', {
    id: 'u',
    display_name: 't',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: false,
    password_change_reason: null,
  })
  renderApp()
  expect(screen.getByText('secret')).toBeInTheDocument()
})

it('navigates to /login when the token is cleared while mounted', () => {
  useAuthStore.getState().setTokens('a', 'r', {
    id: 'u',
    display_name: 't',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: false,
    password_change_reason: null,
  })
  renderApp()
  expect(screen.getByText('secret')).toBeInTheDocument()
  act(() => useAuthStore.getState().logout())
  expect(screen.getByText('login page')).toBeInTheDocument()
})

it('redirects to /change-password when the password must be changed', () => {
  useAuthStore.getState().setTokens('a', 'r', {
    id: 'u',
    display_name: 't',
    contexts: ['teacher'],
    admin_perms: [],
    must_change_password: true,
    password_change_reason: null,
  })
  render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/change-password" element={<div>change pw</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute>
              <div>secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('change pw')).toBeInTheDocument()
})

it('redirects an account with no contexts to /login', () => {
  useAuthStore.getState().setTokens('a', 'r', {
    id: 'u',
    display_name: 't',
    contexts: [],
    admin_perms: [],
    must_change_password: false,
    password_change_reason: null,
  })
  render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute context="admin">
              <div>secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('login page')).toBeInTheDocument()
})

it('sends an old-shape persisted user (no contexts) to /login without crashing', () => {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: { id: 'u', display_name: 't' } as never,
  })
  render(
    <MemoryRouter initialEntries={['/teacher']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/teacher"
          element={
            <ProtectedRoute context="teacher">
              <div>secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(useAuthStore.getState().accessToken).toBeNull()
})

it('lets a parent account into a parent-context route and sends others to their first context', () => {
  const mk = (contexts: ('teacher' | 'parent')[]) => {
    useAuthStore.getState().setTokens('a', 'r', {
      id: 'u',
      display_name: 't',
      contexts,
      admin_perms: [],
      must_change_password: false,
      password_change_reason: null,
    })
    return render(
      <MemoryRouter initialEntries={['/parent']}>
        <Routes>
          <Route path="/teacher" element={<div>teacher home</div>} />
          <Route
            path="/parent"
            element={
              <ProtectedRoute context="parent">
                <div>parent area</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
  }
  mk(['parent'])
  expect(screen.getByText('parent area')).toBeInTheDocument()
  cleanup()
  mk(['teacher'])
  expect(screen.getByText('teacher home')).toBeInTheDocument()
})

it('redirects to /change-password once must_change_password is set mid-session', () => {
  const user = {
    id: 'u',
    display_name: 't',
    contexts: ['teacher' as const],
    admin_perms: [],
    must_change_password: false,
    password_change_reason: null,
  }
  useAuthStore.getState().setTokens('a', 'r', user)
  render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/change-password" element={<div>change page</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute>
              <div>secret</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('secret')).toBeInTheDocument()
  act(() =>
    useAuthStore
      .getState()
      .setUser({ ...user, must_change_password: true, password_change_reason: 'expired' }),
  )
  expect(screen.getByText('change page')).toBeInTheDocument()
})
