import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
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

const dock = (over: Partial<ClassroomDockProps> = {}) => render(
  <ClassroomDock mode="daily" perms={[]} onModeChange={vi.fn()} actions={<button>甲</button>}
    common={<button>乙</button>} status="保存中…" presenting={false} onTogglePresent={vi.fn()}
    railOpen onToggleRail={vi.fn()} {...over} />,
)

it('puts tabs, mode actions, common actions, status and fullscreen / rail into one toolbar in that order', () => {
  dock()
  const bar = screen.getByRole('toolbar', { name: '教室工具' })
  const order = [...bar.querySelectorAll('[role="tab"], button, [role="status"]')].map((el) => el.textContent)
  expect(order).toEqual(['日常', '甲', '乙', '保存中…', '全屏', '概况栏'])
  expect(within(bar).getByRole('button', { name: '概况栏' })).toHaveAttribute('aria-pressed', 'true')
})

it('shows 退出全屏 and hides 概况栏 while presenting', () => {
  dock({ presenting: true })
  expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '概况栏' })).toBeNull()
})
