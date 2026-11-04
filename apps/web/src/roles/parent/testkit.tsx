/* eslint-disable react-refresh/only-export-components */
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, vi } from 'vitest'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useAuthStore } from '@/shared/stores/auth'
import type { ParentChild, ParentProfile, ParentToday } from '@/shared/types/parent'
import ParentLayout, { ParentIndex } from './ParentLayout'
import ProfilePage from './Profile/ProfilePage'
import TodayPage from './Today/TodayPage'

export const child = (over: Partial<ParentChild> = {}): ParentChild => ({
  student_id: 's1', name: '王小一', gender: '女', class_name: '三年二班', grade_name: '三年级',
  relation: '母亲', is_primary: true, status: 'active', left_on: null, archive_on: null, ...over,
})

export const today = (over: Partial<ParentToday> = {}): ParentToday => ({
  date: '2026-11-04', status: 'active', attendance: { status: 'present', reason: null }, attendance_confirmed: true,
  reviews: [], week_points: 0,
  class_info: { class_name: '三年二班', homeroom_name: '陈老师', teachers: [{ subject: '数学', name: '李老师' }] },
  enrollment_id: 'e1',
  seat_map: {
    rows: 2, cols: 2, desk_size: 2, podium_left: 0, podium_right: 0,
    occupied: [{ row: 1, col: 1 }, { row: 1, col: 2 }], mine: { row: 1, col: 2 },
  },
  ...over,
})

export const profile = (over: Partial<ParentProfile> = {}): ParentProfile => ({
  id: 's1', enrollment_id: 'e1', mk: 'm', name: '王小一', class_id: 'c1', can_edit_contacts: true, ...over,
})

export function setParentUser() {
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r', lastContext: null,
    user: { id: 'u', display_name: '王妈妈', contexts: ['parent'], admin_perms: [], must_change_password: false },
  })
}

/** 按 min-width 查询串与当前宽度求值的 matchMedia */
export function mockWidth(width: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0)
    return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} }
  })
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

export function renderParent(entry = '/parent') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/parent" element={<ProtectedRoute context="parent"><ParentLayout /></ProtectedRoute>}>
            <Route index element={<ParentIndex />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="/teacher" element={<div>teacher home</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.getState().logout()
  try { localStorage.clear() } catch { /* 无存储环境 */ }
})
