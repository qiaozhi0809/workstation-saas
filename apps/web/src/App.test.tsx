import { act, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { noticesApi } from '@/shared/api/notices'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import { summaryFixture } from '@/roles/teacher/Classroom/pageTestUtils'
import App from './App'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn(), listInClass: vi.fn() } }))
vi.mock('@/shared/api/notices', () => ({ noticesApi: { inbox: vi.fn(), read: vi.fn(), readAll: vi.fn() } }))
vi.mock('@/shared/realtime/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/realtime/client')>()),
  createRealtimeClient: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

describe('App routing', () => {
  beforeEach(() => {
    vi.mocked(noticesApi.inbox).mockResolvedValue({ items: [], total: 0, unread: 0 })
  })

  it('redirects / to the login page', () => {
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(screen.getByRole('heading', { name: '班级工作台' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('shows a not-found page with a way home', () => {
    window.history.pushState({}, '', '/nope')
    render(<App />)
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/')
  })

  it('redirects the old profile url to the classroom with the drawer parameter', async () => {
    const never = new Promise<never>(() => {})
    vi.mocked(classesApi.mine).mockReturnValue(never)
    vi.mocked(classroomApi.summary).mockReturnValue(never)
    vi.mocked(studentsApi.detail).mockReturnValue(never)
    vi.mocked(studentsApi.listInClass).mockReturnValue(never)
    useAuthStore.setState({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', display_name: '王老师', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
    window.history.pushState({}, '', '/teacher/students/a%20b')
    render(<App />)
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/teacher/classroom?student=a%20b'))
    act(() => useAuthStore.setState({ accessToken: null, refreshToken: null, user: null }))
  })

  describe('AI routes', () => {
    const cls = { id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 6, seat_cols: 4, desk_size: 2 as const, seat_layout: 'manual' as const, seat_order: 'row' as const, podium_left: 0, podium_right: 0, room: '', role: 'subject_teacher' as const }

    beforeEach(() => {
      vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
      useTeacherStore.setState({ classId: 'c1' })
      useAuthStore.setState({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', display_name: '王老师', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
    })
    afterEach(() => act(() => useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })))

    it('routes /teacher/ai and /teacher/ai/:chatId', async () => {
      vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['ai.use'] }))
      window.history.pushState({}, '', '/teacher/ai')
      const { unmount } = render(<App />)
      expect(await screen.findByRole('heading', { level: 1, name: 'AI 助手' })).toBeInTheDocument()
      expect(await screen.findByText('王老师,今天想做点什么?')).toBeInTheDocument()
      unmount()
      window.history.pushState({}, '', '/teacher/ai/chat-1')
      render(<App />)
      expect(await screen.findByRole('heading', { level: 1, name: 'AI 助手' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'AI 助手' })).toHaveAttribute('aria-current', 'page')
      expect(screen.queryByText('你在本班没有这项权限')).toBeNull()
    })

    it('shows the no-permission state without ai.use', async () => {
      vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['exam.read'] }))
      window.history.pushState({}, '', '/teacher/ai')
      const { unmount } = render(<App />)
      expect(await screen.findByText('你在本班没有这项权限')).toBeInTheDocument()
      unmount()
      window.history.pushState({}, '', '/teacher/ai/chat-1')
      render(<App />)
      expect(await screen.findByText('你在本班没有这项权限')).toBeInTheDocument()
    })
  })
})
