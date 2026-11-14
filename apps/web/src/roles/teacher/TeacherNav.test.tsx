import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/shared/components/layout/Sidebar'
import { teacherGroups } from './TeacherNav'

const renderAt = (entry: string, perms?: string[]) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Sidebar
        groups={teacherGroups(perms)}
        collapsed={false}
        onToggle={() => {}}
        header={null}
        footer={null}
      />
    </MemoryRouter>,
  )

it('is one untitled group', () => {
  const groups = teacherGroups(undefined)
  expect(groups).toHaveLength(1)
  expect(groups[0].label).toBeUndefined()
})

it('puts the AI link right after 学生', () => {
  renderAt('/teacher/classroom')
  const names = screen.getAllByRole('link').map((a) => a.textContent)
  expect(names).toEqual(['教室', '成绩', '分析', '学生', 'AI 助手'])
  expect(screen.getByRole('link', { name: 'AI 助手' })).toHaveAttribute('href', '/teacher/ai')
})

it('highlights the AI link on the home page and on a chat page', () => {
  const { unmount } = renderAt('/teacher/ai')
  expect(screen.getByRole('link', { name: 'AI 助手' })).toHaveAttribute('aria-current', 'page')
  unmount()
  renderAt('/teacher/ai/chat-1')
  expect(screen.getByRole('link', { name: 'AI 助手' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: '学生' })).not.toHaveAttribute('aria-current')
})

it('hides 班级公告 without class.notice', () => {
  renderAt('/teacher/classroom', ['attendance.read'])
  expect(screen.queryByRole('link', { name: '班级公告' })).toBeNull()
  cleanup()
  renderAt('/teacher/classroom', undefined)
  expect(screen.queryByRole('link', { name: '班级公告' })).toBeNull()
})

it('shows 班级公告 with class.notice', () => {
  renderAt('/teacher/classroom', ['class.notice'])
  expect(screen.getByRole('link', { name: '班级公告' })).toHaveAttribute('href', '/teacher/notices')
  expect(screen.getAllByRole('link')).toHaveLength(6)
})
