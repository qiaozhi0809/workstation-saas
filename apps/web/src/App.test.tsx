import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import { summaryFixture } from '@/roles/teacher/Classroom/pageTestUtils'
import App from './App'

vi.mock('@/shared/api/classes', () => ({ classesApi: { mine: vi.fn() } }))
vi.mock('@/shared/api/classroom', () => ({ classroomApi: { summary: vi.fn() } }))
vi.mock('@/shared/api/students', () => ({ studentsApi: { detail: vi.fn(), listInClass: vi.fn() } }))

describe('App routing', () => {
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
    useAuthStore.setState({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', display_name: '王老师' } })
    window.history.pushState({}, '', '/teacher/students/a%20b')
    render(<App />)
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/teacher/classroom?student=a%20b'))
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  })

  describe('AI routes', () => {
    const cls = { id: 'c1', name: '三年二班', grade_name: '三年级', seat_rows: 6, seat_cols: 4, role: 'subject_teacher' as const }

    beforeEach(() => {
      vi.mocked(classesApi.mine).mockResolvedValue({ items: [cls] })
      useTeacherStore.setState({ classId: 'c1' })
      useAuthStore.setState({ accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', display_name: '王老师' } })
    })
    afterEach(() => useAuthStore.setState({ accessToken: null, refreshToken: null, user: null }))

    it('routes /teacher/ai and /teacher/ai/:chatId', async () => {
      vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: ['ai.use'] }))
      window.history.pushState({}, '', '/teacher/ai')
      const { unmount } = render(<App />)
      expect(await screen.findByRole('heading', { level: 1, name: 'AI 助手' })).toBeInTheDocument()
      expect(await screen.findByText('AI 助手', { selector: 'h2, p, div' })).toBeInTheDocument()
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
      render(<App />)
      expect(await screen.findByText('你在本班没有这项权限')).toBeInTheDocument()
    })
  })
})
