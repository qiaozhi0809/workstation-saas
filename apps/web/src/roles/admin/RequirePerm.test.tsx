import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import RequirePerm from './RequirePerm'

const renderWith = (perms: AdminPerm[], need: AdminPerm | AdminPerm[] = 'org.manage') => {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: 't',
      contexts: ['admin'],
      admin_perms: perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })
  return render(
    <MemoryRouter initialEntries={['/admin/org']}>
      <Routes>
        <Route path="/admin" element={<div>admin home</div>} />
        <Route
          path="/admin/org"
          element={
            <RequirePerm perm={need}>
              <div>org page</div>
            </RequirePerm>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('renders children when the perm is held', () => {
  renderWith(['org.manage'])
  expect(screen.getByText('org page')).toBeInTheDocument()
})

it('redirects to /admin without the perm', () => {
  renderWith(['account.manage'])
  expect(screen.getByText('admin home')).toBeInTheDocument()
  expect(screen.queryByText('org page')).toBeNull()
})

it('accepts an array of perms: any one is enough (L398)', () => {
  const { unmount } = renderWith(['settings.manage'], ['school.view', 'settings.manage'])
  expect(screen.getByText('org page')).toBeInTheDocument()
  unmount()
  renderWith(['account.manage'], ['school.view', 'settings.manage'])
  expect(screen.getByText('admin home')).toBeInTheDocument()
})
