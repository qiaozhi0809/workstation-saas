import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { AdminPerm } from '@/shared/types/admin'
import AdminHome from './AdminHome'

function Url() {
  return <div data-testid="url">{useLocation().pathname}</div>
}

function landing(perms: AdminPerm[]) {
  useAuthStore.setState({
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u',
      display_name: '测试',
      contexts: ['admin'],
      admin_perms: perms,
      must_change_password: false,
      password_change_reason: null,
    },
  })
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin">
          <Route index element={<AdminHome />} />
          <Route path="*" element={<Url />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  return screen.getByTestId('url').textContent
}

afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

it('信息中心(没有 school.view)仍落在组织架构,不因今日关注开放而改变 (L398)', () => {
  expect(landing(['org.manage', 'settings.manage', 'account.manage'])).toBe('/admin/org')
})

it('有 school.view 的人落在今日关注', () => {
  expect(landing(['school.view', 'org.manage'])).toBe('/admin/today')
})
