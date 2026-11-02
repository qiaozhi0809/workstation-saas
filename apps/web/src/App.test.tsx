import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { useAuthStore } from '@/shared/stores/auth'
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
})
