import { useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Check, GraduationCap } from 'lucide-react'
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { authApi } from '@/shared/api/auth'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { Toaster } from '@/shared/components/Toast'
import AccountMenu from '@/shared/components/layout/AccountMenu'
import { Breadcrumb } from '@/shared/components/layout/Breadcrumb'
import { teacherCrumbs } from '@/shared/components/layout/crumbs'
import NoticeBell from '@/shared/components/layout/NoticeBell'
import SidebarShell from '@/shared/components/layout/SidebarShell'
import Menu, { MenuItem } from '@/shared/components/overlay/Menu'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { compareClassName } from '@/shared/lib/sort'
import { cn } from '@/shared/lib/utils'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { switchTargets } from '@/shared/components/layout/switchTargets'
import { useAuthStore } from '@/shared/stores/auth'
import { confirmLeave, useTeacherStore } from '@/shared/stores/teacher'
import type { ClassView } from '@/shared/types/class'
import ThemeToggle from '@/theme/ThemeToggle'
import StudentProfileDrawer from './StudentProfile/StudentProfileDrawer'
import { useStudentDrawer } from './StudentProfile/useStudentDrawer'
import { teacherGroups } from './TeacherNav'
import WelcomeDialog from './Welcome/WelcomeDialog'

export default function TeacherLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inClassroom = useMatch('/teacher/classroom/*') !== null
  const { studentId } = useStudentDrawer()
  const user = useAuthStore((s) => s.user)
  const classId = useTeacherStore((s) => s.classId)
  const setClass = useTeacherStore((s) => s.setClass)
  const { data, isError } = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  // 年级保持后端给的顺序(管理端设的 display_order),同一年级内按班名自然排序:三年二班 < 三年三班 < 三年十班(L40)
  const classes = useMemo(() => {
    const items = data?.items ?? []
    const grades = [...new Set(items.map((c) => c.grade_name))]
    return [...items].sort(
      (a, b) =>
        grades.indexOf(a.grade_name) - grades.indexOf(b.grade_name) ||
        compareClassName(a.name, b.name),
    )
  }, [data])
  const cls = classes.find((c) => c.id === classId)
  // 与教室页同一个 key,共用缓存;这里不轮询
  const summary = useQuery({
    queryKey: ['classroom', classId],
    queryFn: () => classroomApi.summary(classId!),
    enabled: !!classId,
  })

  useEffect(() => {
    if (user && classes.length > 0 && !classes.some((c) => c.id === classId))
      setClass(classes[0].id)
  }, [user, classes, classId, setClass])

  const logout = () => {
    if (!confirmLeave()) return
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken) authApi.logout(refreshToken).catch(() => {})
    useAuthStore.getState().logout()
    useTeacherStore.setState({ classId: null })
    navigate('/login', { replace: true })
  }

  const info = cls && summary.data && (
    <span className="truncate text-sm text-muted-foreground">
      {[cls.grade_name, cls.room, `${summary.data.year.name} 第 ${summary.data.week_no} 周`]
        .filter(Boolean)
        .join(' · ')}
    </span>
  )

  const onPick = (id: string) => {
    if (confirmLeave()) setClass(id)
  }

  return (
    <RealtimeProvider>
      <SidebarShell
        scope={inClassroom ? 'classroom' : 'default'}
        groups={teacherGroups(summary.data?.my_perms)}
        header={(collapsed) => (
          <>
            <Link
              to="/teacher/classroom"
              aria-label="班级工作台"
              title="班级工作台"
              className="flex min-h-10 min-w-10 items-center gap-2 rounded-md text-foreground"
            >
              <GraduationCap className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {!collapsed && <span className="truncate font-medium">班级工作台</span>}
            </Link>
            <ClassSwitcher
              collapsed={collapsed}
              classes={classes}
              classId={classId}
              failed={isError}
              weekNo={summary.data?.week_no}
              info={info}
              onPick={onPick}
            />
          </>
        )}
        footer={(collapsed) => (
          <>
            <NoticeBell side="top" />
            <ThemeToggle compact />
            <AccountMenu
              name={user?.display_name}
              onLogout={logout}
              switchTo={switchTargets(user?.contexts, 'teacher')}
              placement="top"
              compact={collapsed}
            />
          </>
        )}
        breadcrumb={inClassroom ? null : <Breadcrumb items={teacherCrumbs(pathname)} />}
        overlays={
          <>
            {studentId && <StudentProfileDrawer key={studentId} studentId={studentId} />}
            <WelcomeDialog />
            <Toaster />
          </>
        }
      >
        <Outlet />
      </SidebarShell>
    </RealtimeProvider>
  )
}

/** 侧栏里的班级:展开时是下拉加一行「年级 · 教室 · 学年 第 N 周」;rail 下是班名首字按钮(点开列各班)加周次 */
function ClassSwitcher({
  collapsed,
  classes,
  classId,
  failed,
  weekNo,
  info,
  onPick,
}: {
  collapsed: boolean
  classes: ClassView[]
  classId: string | null
  failed: boolean
  weekNo: number | undefined
  info: ReactNode
  onPick(id: string): void
}) {
  const current = classes.find((c) => c.id === classId)
  const error = failed && (
    <span
      role="status"
      title="班级加载失败"
      className={collapsed ? 'text-destructive' : 'shrink-0 text-sm text-destructive'}
    >
      {collapsed && <AlertCircle className="h-4 w-4" aria-hidden="true" />}
      <span className={collapsed ? 'sr-only' : undefined}>班级加载失败</span>
    </span>
  )

  if (!collapsed) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {error}
        {classes.length === 1 && <span className="truncate font-medium">{classes[0].name}</span>}
        {classes.length > 1 && (
          <NativeSelect
            aria-label="切换班级"
            className="w-full min-w-0"
            value={classId ?? ''}
            onChange={(e) => onPick(e.target.value)}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {info}
      </div>
    )
  }

  const initial = Array.from(current?.name ?? classes[0]?.name ?? '')[0]
  const week = weekNo !== undefined && (
    <span className="text-xs text-muted-foreground">{weekNo} 周</span>
  )
  const badge =
    'bg-accent text-sm font-medium'
  return (
    <div className="flex flex-col items-center gap-1">
      {error}
      {classes.length === 1 && (
        <span
          title={classes[0].name}
          className={cn(
            badge,
            'flex h-10 w-10 items-center justify-center rounded-md',
          )}
        >
          {initial}
        </span>
      )}
      {classes.length > 1 && (
        <Menu
          label="切换班级"
          side="bottom"
          align="start"
          triggerProps={{
            variant: 'ghost',
            size: 'icon',
            className: badge,
            'aria-label': `切换班级,当前${current?.name ?? ''}`,
            title: current?.name,
          }}
          trigger={<span aria-hidden="true">{initial}</span>}
        >
          {classes.map((c) => (
            <MenuItem key={c.id} onSelect={() => onPick(c.id)}>
              <span className="mr-2">{c.name}</span>
              {c.id === classId && (
                <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
              )}
            </MenuItem>
          ))}
        </Menu>
      )}
      {week}
    </div>
  )
}
