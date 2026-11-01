import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useMatch, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { Toaster } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import StudentProfileDrawer from './StudentProfile/StudentProfileDrawer'

export default function TeacherLayout() {
  const navigate = useNavigate()
  const studentMatch = useMatch('/teacher/students/:id')
  const user = useAuthStore((s) => s.user)
  const classId = useTeacherStore((s) => s.classId)
  const setClass = useTeacherStore((s) => s.setClass)
  const { data, isError } = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const classes = useMemo(() => data?.items ?? [], [data])

  useEffect(() => {
    if (user && classes.length > 0 && !classes.some((c) => c.id === classId)) setClass(classes[0].id)
  }, [user, classes, classId, setClass])

  const logout = () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    useTeacherStore.setState({ classId: null })
    navigate('/login', { replace: true })
  }

  return (
    <div className="h-full grid grid-rows-[48px_1fr]">
      <header className="flex items-center justify-between px-4 border-b bg-panel">
        <div className="flex items-center gap-4">
          <Link to="/teacher/classroom" className="font-semibold">班级工作台</Link>
          {isError && <span>班级加载失败</span>}
          {classes.length === 1 && <span>{classes[0].name}</span>}
          {classes.length > 1 && (
            <select aria-label="切换班级" value={classId ?? ''} onChange={(e) => setClass(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span>{user?.display_name}</span>
          <button type="button" onClick={logout}>退出登录</button>
        </div>
      </header>
      <main className="overflow-auto"><Outlet /></main>
      {studentMatch?.params.id && <StudentProfileDrawer key={studentMatch.params.id} studentId={studentMatch.params.id} />}
      <Toaster />
    </div>
  )
}
