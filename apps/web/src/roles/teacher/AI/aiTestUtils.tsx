/* eslint-disable react-refresh/only-export-components -- 测试辅助模块,不参与热更新 */
// AI 页测试的共用夹具与渲染辅助(只给 *.test.tsx 用)。
// 每个测试文件自己写(vi.mock 按文件提升):
//   vi.mock('@/shared/api/ai'); vi.mock('@/shared/api/classes'); vi.mock('@/shared/api/classroom')
//   vi.mock('@/shared/api/students'); vi.mock('@/shared/api/exams')
// 然后 beforeEach 里 `vi.resetAllMocks(); defaultAiMocks()`。
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { aiApi } from '@/shared/api/ai'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { examsApi } from '@/shared/api/exams'
import { studentsApi } from '@/shared/api/students'
import { Toaster } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { ClassPerm } from '@/shared/types/classroom'
import type { AiChatSummary, AiStatus, AiTemplate, AiTemplates } from '@/shared/types/ai'
import { classFixture, rosterFixture, summaryFixture } from '../Classroom/pageTestUtils'

export const statusFixture: AiStatus = {
  configured: true, provider_label: 'DeepSeek · deepseek-flash', mask_forced: false,
}

const tpl = (over: Partial<AiTemplate> & Pick<AiTemplate, 'id' | 'title'>): AiTemplate => ({
  cat: 'teach', desc: `${over.title}的说明`, rec: false, hidden: false, batch: false,
  fields: [], available: true, unavailable_reason: null, ...over,
})

export const templatesFixture: AiTemplates = {
  categories: [
    { id: 'rec', label: '推荐' }, { id: 'teach', label: '教学' }, { id: 'manage', label: '班级管理' },
    { id: 'home', label: '家校沟通' }, { id: 'grow', label: '学生成长' },
  ],
  items: [
    tpl({ id: 'lesson', title: '教案设计', cat: 'teach', rec: true }),
    tpl({ id: 'ppt', title: '课件大纲', cat: 'teach', rec: true }),
    tpl({ id: 'homework', title: '作业设计', cat: 'teach' }),
    tpl({ id: 'meeting', title: '班会方案', cat: 'manage', rec: true }),
    tpl({ id: 'notice', title: '通知文案', cat: 'manage', rec: true }),
    tpl({ id: 'parent', title: '家长沟通话术', cat: 'home', rec: true, available: false, unavailable_reason: '仅班主任可用' }),
    tpl({ id: 'pmeeting', title: '家长会发言稿', cat: 'home' }),
    tpl({ id: 'comments', title: '期末评语', cat: 'grow' }),
    tpl({ id: 'talk', title: '隐藏的模板', cat: 'grow', rec: true, hidden: true }),
  ],
}

/** 覆盖全部字段类型的模板(report) */
export const formTemplateFixture: AiTemplate = tpl({
  id: 'report', title: '成绩分析', cat: 'grow',
  fields: [
    { key: 'topic', type: 'text', label: '课题', required: true, placeholder: '比如:期中复盘' },
    { key: 'note', type: 'textarea', label: '补充说明', required: false },
    { key: 'tone', type: 'select', label: '语气', required: false, options: ['温和', '严肃', '鼓励'], default: '温和' },
    { key: 'tips', type: 'check', label: '附带建议', required: false, default: true },
    { key: 'who', type: 'student', label: '学生', required: true },
    { key: 'group', type: 'students', label: '同学', required: false },
    { key: 'cur', type: 'exam', label: '考试', required: true },
    { key: 'prev', type: 'exam0', label: '对比考试', required: false },
  ],
})

/** 仅入口可用的隐藏模板(单个学生评语) */
export const hiddenTemplateFixture: AiTemplate = tpl({
  id: 'comment1', title: '个人评语', cat: 'grow', hidden: true,
  fields: [
    { key: 'student', type: 'student', label: '学生', required: true },
    { key: 'exam', type: 'exam', label: '考试', required: false },
    { key: 'vs', type: 'exam0', label: '对比考试', required: false },
  ],
})

/** 新 → 旧 */
export const examsFixture = [
  { id: 'x3', name: '期末考试', exam_type: 'final', date: '2027-01-10', subjects: [], created_by_me: true, progress: { entered: 3, total: 3 } },
  { id: 'x2', name: '月考', exam_type: 'monthly', date: '2026-11-20', subjects: [], created_by_me: true, progress: { entered: 3, total: 3 } },
  { id: 'x1', name: '期中考试', exam_type: 'midterm', date: '2026-10-20', subjects: [], created_by_me: true, progress: { entered: 3, total: 3 } },
]

export const chatsFixture: AiChatSummary[] = [
  { id: 'c1', title: '期中家长会发言稿', template_id: 'pmeeting', updated_at: '2026-11-02T01:30:00Z' },
  { id: 'c2', title: '班会方案', template_id: 'meeting', updated_at: '2026-11-01T14:05:00Z' },
]

export function defaultAiMocks() {
  vi.mocked(classesApi.mine).mockResolvedValue({ items: [classFixture] })
  vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture())
  vi.mocked(studentsApi.listInClass).mockResolvedValue({ items: rosterFixture })
  vi.mocked(examsApi.list).mockResolvedValue({ items: [
    { id: 'x1', name: '期中考试', exam_type: 'midterm', date: '2026-10-20', subjects: [], created_by_me: true, progress: { entered: 3, total: 3 } },
  ] } as never)
  vi.mocked(aiApi.status).mockResolvedValue(statusFixture)
  vi.mocked(aiApi.templates).mockResolvedValue(templatesFixture)
  vi.mocked(aiApi.listChats).mockResolvedValue({ items: chatsFixture })
  vi.mocked(aiApi.deleteChat).mockResolvedValue(undefined)
}

function Url() {
  const { pathname, search } = useLocation()
  return <div data-testid="url">{pathname + search}</div>
}

export interface AiSetupOptions {
  /** 覆盖 summary 的 my_perms(默认 ai.use + 全部班级权限)。 */
  perms?: ClassPerm[]
  /** 渲染的页面元素 */
  element: ReactElement
  /** 页面路由 path,默认 /teacher/ai */
  path?: string
  entry?: string
}

/** 渲染 AI 页(QueryClient 关重试 + 内存 data router + Toaster + 地址探针 data-testid="url")。 */
export function setupAi({ perms, element, path = '/teacher/ai', entry = '/teacher/ai' }: AiSetupOptions) {
  if (perms) vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({ my_perms: perms }))
  else vi.mocked(classroomApi.summary).mockResolvedValue(summaryFixture({
    my_perms: [...summaryFixture().my_perms, 'ai.use'],
  }))
  act(() => {
    useTeacherStore.setState({ classId: 'c1' })
    useAuthStore.setState({ user: { id: 'u1', display_name: '王', contexts: ['teacher'], admin_perms: [], must_change_password: false } })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    { path, element: <>{element}<Url /></> },
    { path: '*', element: <Url /> },
  ], { initialEntries: [entry] })
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return { ...result, client, router }
}
