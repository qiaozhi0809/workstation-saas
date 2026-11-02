import { lazy, Suspense, useState } from 'react'
import {
  createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider,
} from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/api/queryClient'
import LoginPage from '@/auth/LoginPage'
import TeacherLayout from '@/roles/teacher/TeacherLayout'
import ClassroomPage from '@/roles/teacher/Classroom/ClassroomPage'
import PreferencesPage from '@/roles/teacher/Preferences/PreferencesPage'
import ProtectedRoute from '@/shared/components/ProtectedRoute'
import { useApplyTheme } from '@/theme/useTheme'

const ClassroomPlayground = import.meta.env.DEV ? lazy(() => import('@/dev/ClassroomPlayground')) : null

// data router:教室页排座未保存时用 useBlocker 拦截站内跳转,它只能在 data router 下用
const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/teacher" element={<ProtectedRoute><TeacherLayout /></ProtectedRoute>}>
      <Route index element={<Navigate to="classroom" replace />} />
      <Route path="classroom" element={<ClassroomPage />} />
      <Route path="preferences" element={<PreferencesPage />} />
      <Route path="students/:id" element={<ClassroomPage />} />
    </Route>
    {ClassroomPlayground && (
      <Route path="/dev/classroom" element={<Suspense fallback={null}><ClassroomPlayground /></Suspense>} />
    )}
    <Route path="/admin" element={<div className="p-6">管理端(M3)</div>} />
    <Route path="/parent" element={<div className="p-6">家长端(M4)</div>} />
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="*" element={<div className="p-6">404</div>} />
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
