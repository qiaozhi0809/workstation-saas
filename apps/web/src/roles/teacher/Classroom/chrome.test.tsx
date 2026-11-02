import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Toolbar from './Toolbar'
import ModeBar from './ModeBar'

it('zoom controls are labelled icon buttons in a group', () => {
  const viewport = { current: { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() } }
  render(<Toolbar viewport={viewport as never} presenting={false} onTogglePresent={() => {}} railOpen onToggleRail={() => {}} />)
  const group = screen.getByRole('group', { name: '缩放' })
  for (const name of ['缩小', '适应', '放大']) {
    const b = within(group).getByRole('button', { name })
    expect(b).toHaveAttribute('title', name)
    expect(b.querySelector('svg')).not.toBeNull()
  }
  fireEvent.click(within(group).getByRole('button', { name: '适应' }))
  expect(viewport.current.fit).toHaveBeenCalled()
})

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
