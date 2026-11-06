import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MenuItem } from '@/shared/components/overlay/Menu'
import ClassroomDock, { type ClassroomDockProps } from './ClassroomDock'
import ModeBar from './ModeBar'

it('mode bar moves focus with arrow keys and switches on click only', () => {
  const onChange = vi.fn()
  render(<ModeBar mode="daily" perms={['attendance.read', 'review.read']} onChange={onChange} />)
  const daily = screen.getByRole('tab', { name: '日常' })
  daily.focus()
  fireEvent.keyDown(daily, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: '考勤' })).toHaveFocus()
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(daily)
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('tab', { name: '考勤' }))
  expect(onChange).toHaveBeenCalledWith('attendance')
})

const dock = (over: Partial<ClassroomDockProps> = {}) =>
  render(
    <ClassroomDock
      mode="daily"
      perms={[]}
      onModeChange={vi.fn()}
      actions={<button>甲</button>}
      common={<button>乙</button>}
      status="保存中…"
      presenting={false}
      onTogglePresent={vi.fn()}
      onOpenPanel={vi.fn()}
      {...over}
    />,
  )

it('puts tabs, mode actions, common actions, status and fullscreen / 待办与点评 into one toolbar in that order', () => {
  dock()
  const bar = screen.getByRole('toolbar', { name: '教室工具' })
  const order = [...bar.querySelectorAll('[role="tab"], button, [role="status"]')].map(
    (el) => el.getAttribute('aria-label') ?? el.textContent,
  )
  expect(order).toEqual(['日常', '甲', '乙', '保存中…', '全屏', '待办与点评'])
  expect(within(bar).getByRole('button', { name: '待办与点评' })).toHaveAttribute(
    'aria-haspopup',
    'dialog',
  )
})

it('calls onOpenPanel from the 待办与点评 button', () => {
  const onOpenPanel = vi.fn()
  dock({ onOpenPanel })
  fireEvent.click(screen.getByRole('button', { name: '待办与点评' }))
  expect(onOpenPanel).toHaveBeenCalledTimes(1)
})

it('shows 退出全屏 and hides 待办与点评 while presenting', () => {
  dock({ presenting: true })
  expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '待办与点评' })).toBeNull()
})

it('draws a separator only before a non-empty actions or common zone', () => {
  const seps = () =>
    screen
      .getByRole('toolbar', { name: '教室工具' })
      .querySelectorAll('[data-orientation="vertical"]').length
  const { unmount } = dock()
  expect(seps()).toBe(2)
  unmount()
  const a = dock({ actions: undefined })
  expect(seps()).toBe(1)
  a.unmount()
  const b = dock({ common: undefined })
  expect(seps()).toBe(1)
  b.unmount()
  dock({ actions: undefined, common: undefined })
  expect(seps()).toBe(0)
})

it('shows 全屏 and 待办与点评 as icon-only buttons that keep their names and carry a title', () => {
  dock()
  for (const name of ['全屏', '待办与点评']) {
    const b = screen.getByRole('button', { name })
    expect(b).toHaveAttribute('title', name)
    expect(b.textContent).toBe('')
  }
  dock({ presenting: true })
  const exit = screen.getByRole('button', { name: '退出全屏' })
  expect(exit).toHaveAttribute('title', '退出全屏')
  expect(exit.textContent).toBe('')
})

it('shows the 看看教室 toggle before 全屏 only when cameras are given, with its open state', () => {
  const onToggle = vi.fn()
  const { unmount } = dock({ cameras: { open: false, onToggle } })
  const bar = screen.getByRole('toolbar', { name: '教室工具' })
  const toggle = within(bar).getByTestId('camera-toggle')
  expect(toggle).toHaveAccessibleName('看看教室')
  expect(toggle).toHaveAttribute('title', '看看教室')
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle.textContent).toBe('')
  expect(
    [...bar.querySelectorAll('[role="tab"], button, [role="status"]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    ),
  ).toEqual(['日常', '甲', '乙', '保存中…', '看看教室', '全屏', '待办与点评'])
  fireEvent.click(toggle)
  expect(onToggle).toHaveBeenCalledTimes(1)
  unmount()
  const open = dock({ cameras: { open: true, onToggle }, presenting: true })
  expect(screen.getByTestId('camera-toggle')).toHaveAttribute('aria-pressed', 'true')
  open.unmount()
  dock()
  expect(screen.queryByTestId('camera-toggle')).toBeNull()
})

it('renders one 更多操作 menu from the menu items, after the common zone, and none without items', () => {
  const { unmount } = dock({
    menu: (
      <>
        <MenuItem onSelect={vi.fn()}>丙</MenuItem>
        <MenuItem onSelect={vi.fn()}>丁</MenuItem>
      </>
    ),
  })
  const bar = screen.getByRole('toolbar', { name: '教室工具' })
  const more = within(bar).getByRole('button', { name: '更多操作' })
  expect(more).toHaveAttribute('title', '更多操作')
  expect(within(bar).getAllByRole('button', { name: '更多操作' })).toHaveLength(1)
  expect(
    [...bar.querySelectorAll('[role="tab"], button, [role="status"]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    ),
  ).toEqual(['日常', '甲', '乙', '更多操作', '保存中…', '全屏', '待办与点评'])
  fireEvent.click(more)
  expect(
    within(screen.getByRole('menu', { name: '更多操作' }))
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['丙', '丁'])
  unmount()
  dock()
  expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull()
})
