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
        <Route path="/private" element={<ProtectedRoute><div>secret</div></ProtectedRoute>} />
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
  useAuthStore.getState().setTokens('a', 'r', { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false })
  renderApp()
  expect(screen.getByText('secret')).toBeInTheDocument()
})

it('navigates to /login when the token is cleared while mounted', () => {
  useAuthStore.getState().setTokens('a', 'r', { id: 'u', display_name: 't', contexts: ['teacher'], admin_perms: [], must_change_password: false })
  renderApp()
  expect(screen.getByText('secret')).toBeInTheDocument()
  act(() => useAuthStore.getState().logout())
  expect(screen.getByText('login page')).toBeInTheDocument()
})
