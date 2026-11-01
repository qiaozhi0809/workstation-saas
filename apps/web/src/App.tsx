import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/api/queryClient'
import LoginPage from '@/auth/LoginPage'
import TeacherLayout from '@/roles/teacher/TeacherLayout'
import ClassroomPage from '@/roles/teacher/Classroom/ClassroomPage'
import ProtectedRoute from '@/shared/components/ProtectedRoute'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/teacher" element={<ProtectedRoute><TeacherLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="classroom" replace />} />
            <Route path="classroom" element={<ClassroomPage />} />
            <Route path="students/:id" element={<ClassroomPage />} />
          </Route>
          <Route path="/admin" element={<div className="p-6">管理端(M3)</div>} />
          <Route path="/parent" element={<div className="p-6">家长端(M4)</div>} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<div className="p-6">404</div>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
