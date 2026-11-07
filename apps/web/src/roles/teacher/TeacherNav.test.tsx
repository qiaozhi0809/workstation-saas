import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeacherNav from './TeacherNav'

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TeacherNav />
    </MemoryRouter>,
  )

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

const renderWith = (perms?: string[]) =>
  render(
    <MemoryRouter initialEntries={['/teacher/classroom']}>
      <TeacherNav perms={perms} />
    </MemoryRouter>,
  )

it('hides 班级公告 without class.notice', () => {
  renderWith(['attendance.read'])
  expect(screen.queryByRole('link', { name: '班级公告' })).toBeNull()
  cleanup()
  renderWith(undefined)
  expect(screen.queryByRole('link', { name: '班级公告' })).toBeNull()
})

it('shows 班级公告 with class.notice', () => {
  renderWith(['class.notice'])
  expect(screen.getByRole('link', { name: '班级公告' })).toHaveAttribute('href', '/teacher/notices')
})

// L260:< 768px 只剩图标,鼠标悬停要能看到名称;title 与可见 / 读屏文字同一个 label
it('titles every link with its label for the icon-only layout', () => {
  renderWith(['class.notice'])
  const links = screen.getAllByRole('link')
  expect(links).toHaveLength(6)
  for (const a of links) expect(a).toHaveAttribute('title', a.textContent)
  expect(screen.getByRole('link', { name: '教室' })).toHaveAttribute('title', '教室')
})

// L82:触屏下点击区放大到 44 × 44 由 theme/index.css 的 .touch-target 规则负责,这里确认每个入口都挂了钩子
it('marks every nav link as a touch target', () => {
  renderWith(['class.notice'])
  const links = screen.getAllByRole('link')
  expect(links).toHaveLength(6)
  for (const a of links) expect(a).toHaveClass('touch-target')
})
