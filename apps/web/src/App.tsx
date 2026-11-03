import { lazy, Suspense, useState } from 'react'
import {
  createBrowserRouter, createRoutesFromElements, Link, Navigate, Route, RouterProvider, useParams,
} from 'react-router-dom'
import { FileQuestion } from 'lucide-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/api/queryClient'
import ChangePasswordPage from '@/auth/ChangePasswordPage'
import LoginPage from '@/auth/LoginPage'
import AdminHome from '@/roles/admin/AdminHome'
import AdminLayout from '@/roles/admin/AdminLayout'
import { ADMIN_PAGES } from '@/roles/admin/pages'
import TeacherLayout from '@/roles/teacher/TeacherLayout'
import ClassroomPage from '@/roles/teacher/Classroom/ClassroomPage'
import AnalysisPage from '@/roles/teacher/Analysis/AnalysisPage'
import ScoresPage from '@/roles/teacher/Scores/ScoresPage'
import StudentsPage from '@/roles/teacher/Students/StudentsPage'
import AiHomePage from '@/roles/teacher/AI/AiHomePage'
import AiThreadPage from '@/roles/teacher/AI/AiThreadPage'
import PreferencesPage from '@/roles/teacher/Preferences/PreferencesPage'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { Button } from '@/shared/components/ui/button'
import { useApplyTheme } from '@/theme/useTheme'

const ClassroomPlayground = import.meta.env.DEV ? lazy(() => import('@/dev/ClassroomPlayground')) : null

/** 旧的学生档案地址 /teacher/students/:id → 教室页并打开档案抽屉 */
function StudentRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/teacher/classroom?student=${encodeURIComponent(id)}`} replace />
}

// data router:教室页排座未保存时用 useBlocker 拦截站内跳转,它只能在 data router 下用
const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/teacher" element={<ProtectedRoute context="teacher"><TeacherLayout /></ProtectedRoute>}>
      <Route index element={<Navigate to="classroom" replace />} />
      <Route path="classroom" element={<ClassroomPage />} />
      <Route path="preferences" element={<PreferencesPage />} />
      <Route path="scores" element={<ScoresPage />} />
      <Route path="analysis" element={<AnalysisPage />} />
      <Route path="students" element={<StudentsPage />} />
      <Route path="students/:id" element={<StudentRedirect />} />
      <Route path="ai" element={<AiHomePage />} />
      <Route path="ai/:chatId" element={<AiThreadPage />} />
    </Route>
    {ClassroomPlayground && (
      <Route path="/dev/classroom" element={<Suspense fallback={null}><ClassroomPlayground /></Suspense>} />
    )}
    <Route path="/change-password" element={<ChangePasswordPage />} />
    <Route path="/admin" element={<ProtectedRoute context="admin"><AdminLayout /></ProtectedRoute>}>
      <Route index element={<AdminHome />} />
      {ADMIN_PAGES.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
    </Route>
    <Route path="/parent" element={<EmptyState title="家长端(M4)" className="h-full justify-center p-6" />} />
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route
      path="*"
      element={(
        <EmptyState
          icon={FileQuestion}
          title="页面不存在"
          action={<Button asChild className="mt-2"><Link to="/">回到首页</Link></Button>}
          className="h-full justify-center p-6"
        />
      )}
    />
  </>,
)

export default function App() {
  useApplyTheme()
  // 挂载时才建 router,它从当时的地址栏开始
  const [router] = useState(() => createBrowserRouter(routes))
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
