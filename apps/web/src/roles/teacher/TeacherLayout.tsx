import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { Toaster } from '@/shared/components/Toast'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import AppShell from '@/shared/components/layout/AppShell'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { useAuthStore } from '@/shared/stores/auth'
import { confirmLeave, useTeacherStore } from '@/shared/stores/teacher'
import ThemeToggle from '@/theme/ThemeToggle'
import StudentProfileDrawer from './StudentProfile/StudentProfileDrawer'
import { useStudentDrawer } from './StudentProfile/useStudentDrawer'
import TeacherNav from './TeacherNav'

export default function TeacherLayout() {
  const navigate = useNavigate()
  const { studentId } = useStudentDrawer()
  const user = useAuthStore((s) => s.user)
  const classId = useTeacherStore((s) => s.classId)
  const setClass = useTeacherStore((s) => s.setClass)
  const { data, isError } = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const classes = useMemo(() => data?.items ?? [], [data])
  const cls = classes.find((c) => c.id === classId)
  // 与教室页同一个 key,共用缓存;这里不轮询
  const summary = useQuery({ queryKey: ['classroom', classId], queryFn: () => classroomApi.summary(classId!), enabled: !!classId })

  useEffect(() => {
    if (user && classes.length > 0 && !classes.some((c) => c.id === classId)) setClass(classes[0].id)
  }, [user, classes, classId, setClass])

  const logout = () => {
    if (!confirmLeave()) return
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
          onChange={(e) => { if (confirmLeave()) setClass(e.target.value) }}
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      )}
      {cls && summary.data && (
        <span className="hidden truncate text-sm text-muted-foreground sm:inline">
          {[cls.grade_name, cls.room, `${summary.data.year.name} 第 ${summary.data.week_no} 周`].filter(Boolean).join(' · ')}
        </span>
      )}
    </>
  )

  const actions = (
    <>
      <ThemeToggle />
      <AccountMenu
        name={user?.display_name}
        onLogout={logout}
        switchTo={user?.contexts.includes('admin') ? { label: '切换到管理端', to: '/admin' } : undefined}
      />
    </>
  )

  return (
    <AppShell
      home="/teacher/classroom"
      context={context}
      nav={<TeacherNav />}
      actions={actions}
      overlays={
        <>
          {studentId && <StudentProfileDrawer key={studentId} studentId={studentId} />}
          <Toaster />
        </>
      }
    >
      <Outlet />
    </AppShell>
  )
}
