import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useMatch, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { Toaster } from '@/shared/components/Toast'
import AppShell, { type ShellLayout } from '@/shared/components/layout/AppShell'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { useAuthStore } from '@/shared/stores/auth'
import { confirmLeaveSeating, useTeacherStore } from '@/shared/stores/teacher'
import ThemeToggle from '@/theme/ThemeToggle'
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
    if (!confirmLeaveSeating()) return
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    useTeacherStore.setState({ classId: null })
    navigate('/login', { replace: true })
  }

  const context = (
    <>
      {isError && <span className="shrink-0 text-sm text-destructive">班级加载失败</span>}
      {classes.length === 1 && <span className="truncate font-medium">{classes[0].name}</span>}
      {classes.length > 1 && (
        <NativeSelect
          aria-label="切换班级"
          className="min-w-0 max-w-[40vw] md:max-w-xs"
          value={classId ?? ''}
          onChange={(e) => { if (confirmLeaveSeating()) setClass(e.target.value) }}
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      )}
    </>
  )

  const actions = (layout: ShellLayout) => {
    const item = layout === 'menu' ? 'w-full justify-start' : undefined
    return (
      <>
        {/* 排座有未保存修改时,站内跳转由教室页的路由守卫确认 */}
        <Button variant="ghost" size="sm" className={item} asChild>
          <Link to="/teacher/preferences">我的偏好</Link>
        </Button>
        <ThemeToggle className={item} showLabel={layout === 'menu'} />
        <span className={layout === 'menu' ? 'truncate px-3 py-1.5 text-sm text-muted-foreground' : 'max-w-[10rem] truncate px-2 text-sm text-muted-foreground'}>
          {user?.display_name}
        </span>
        <Button variant="ghost" size="sm" className={item} onClick={logout}>退出登录</Button>
      </>
    )
  }

  return (
    <AppShell
      home="/teacher/classroom"
      context={context}
      actions={actions}
      overlays={
        <>
          {studentMatch?.params.id && <StudentProfileDrawer key={studentMatch.params.id} studentId={studentMatch.params.id} />}
          <Toaster />
        </>
      }
    >
      <Outlet />
    </AppShell>
  )
}
