import { fireEvent, render, screen } from '@testing-library/react'
import { Bell } from 'lucide-react'
import { Checkbox } from './checkbox'
import { IconButton } from './icon-button'
import { StatusDot } from './status-dot'
import { Switch } from './switch'

describe('Switch', () => {
  it('is a native checkbox with role switch', () => {
    render(<Switch label="本周之星" />)
    const sw = screen.getByRole('switch', { name: '本周之星' })
    expect(sw.tagName).toBe('INPUT')
    expect(sw).toHaveAttribute('type', 'checkbox')
    expect(sw).not.toBeChecked()
    fireEvent.click(sw)
    expect(sw).toBeChecked()
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('works controlled and reports changes', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="开关" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch', { name: '开关' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('renders description and disabled state', () => {
    render(<Switch label="提醒" description="每天 8 点" disabled />)
    expect(screen.getByText('每天 8 点')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /提醒/ })).toBeDisabled()
  })

  it('hit area is at least 32', () => {
    render(<Switch label="本周之星" />)
    expect(screen.getByRole('switch').closest('label')).toHaveClass('min-h-8')
  })
})

describe('Checkbox', () => {
  it('keeps role checkbox', () => {
    render(<Checkbox label="全选" />)
    const box = screen.getByRole('checkbox', { name: '全选' })
    expect(box.tagName).toBe('INPUT')
    fireEvent.click(box)
    expect(box).toBeChecked()
  })

  it('hit area is at least 32', () => {
    render(<Checkbox label="全选" />)
    expect(screen.getByRole('checkbox').closest('label')).toHaveClass('min-h-8')
  })
})

describe('IconButton', () => {
  it('requires aria-label', () => {
    // @ts-expect-error aria-label 必填
    render(<IconButton icon={Bell} />)
    render(<IconButton icon={Bell} aria-label="通知" />)
    expect(screen.getByRole('button', { name: '通知' })).toHaveAttribute('type', 'button')
  })

  it('sizes', () => {
    render(
      <>
        <IconButton icon={Bell} aria-label="小" size="sm" />
        <IconButton icon={Bell} aria-label="中" />
        <IconButton icon={Bell} aria-label="触控" size="touch" />
      </>,
    )
    expect(screen.getByRole('button', { name: '小' })).toHaveClass('h-8', 'w-8')
    expect(screen.getByRole('button', { name: '中' })).toHaveClass('h-10', 'w-10')
    expect(screen.getByRole('button', { name: '触控' })).toHaveClass('min-h-11', 'min-w-11')
  })
})

describe('StatusDot', () => {
  it('pairs color with text', () => {
    const { container } = render(<StatusDot tone="danger">异常</StatusDot>)
    expect(screen.getByText('异常')).toBeInTheDocument()
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).not.toBeNull()
    expect(dot).toHaveClass('h-1.5', 'w-1.5', 'rounded-full')
  })
})
