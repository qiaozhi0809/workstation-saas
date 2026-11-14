import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Button, buttonClass } from './button'

// L13:Button 默认 type="button",放进 <form> 里不会误提交;要提交的按钮显式写 type="submit"
it('defaults to type="button" so a button inside a form does not submit it', () => {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
  render(
    <form onSubmit={onSubmit}>
      <Button>取消</Button>
      <Button type="submit">保存</Button>
    </form>,
  )
  expect(screen.getByRole('button', { name: '取消' })).toHaveAttribute('type', 'button')
  expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('type', 'submit')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onSubmit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(onSubmit).toHaveBeenCalledTimes(1)
})

it('does not put a type attribute on an asChild link', () => {
  render(
    <Button asChild>
      <a href="/teacher/ai">去 AI 助手</a>
    </Button>,
  )
  expect(screen.getByRole('link', { name: '去 AI 助手' })).not.toHaveAttribute('type')
})

it('renders a native button with type=button by default', () => {
  render(<Button>确定</Button>)
  const el = screen.getByRole('button', { name: '确定' })
  expect(el.tagName).toBe('BUTTON')
  expect(el).toHaveAttribute('type', 'button')
})

// 适配层把 Arc 的 variant / size 写到根元素的 data-variant / data-size(CSS 模块在 vitest 里不出类名)
it.each([
  ['default', 'primary'],
  ['outline', 'secondary'],
  ['secondary', 'secondary'],
  ['ghost', 'ghost'],
  ['destructive', 'danger'],
] as const)('maps %s to arc %s', (variant, arc) => {
  render(<Button variant={variant}>按钮</Button>)
  expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('data-variant', arc)
})

it.each([
  ['default', 'md'],
  ['sm', 'sm'],
  ['lg', 'lg'],
] as const)('maps size %s to arc %s', (size, arc) => {
  render(<Button size={size}>按钮</Button>)
  expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('data-size', arc)
})

it('asChild renders the child link with button classes', () => {
  render(
    <Button asChild>
      <a href="/x">去</a>
    </Button>,
  )
  const link = screen.getByRole('link', { name: '去' })
  for (const cls of buttonClass({}).split(/\s+/)) expect(link).toHaveClass(cls)
})

it('icon sizes stay project-rendered', () => {
  render(
    <>
      <Button size="icon" aria-label="图标">
        x
      </Button>
      <Button size="icon-sm" aria-label="小图标">
        x
      </Button>
      <Button size="touch">触控</Button>
    </>,
  )
  const icon = screen.getByRole('button', { name: '图标' })
  expect(icon).toHaveClass('h-10', 'w-10', 'rounded-md')
  expect(icon).not.toHaveAttribute('data-variant')
  expect(screen.getByRole('button', { name: '小图标' })).toHaveClass('h-8', 'w-8')
  expect(screen.getByRole('button', { name: '触控' })).toHaveClass('min-h-11', 'min-w-11')
})

it('link variant is a native button with type=button', () => {
  render(<Button variant="link">更多</Button>)
  const el = screen.getByRole('button', { name: '更多' })
  expect(el).toHaveAttribute('type', 'button')
  expect(el).not.toHaveAttribute('data-variant')
})

it('loading swallows clicks', () => {
  const onClick = vi.fn()
  render(
    <Button loading onClick={onClick}>
      保存
    </Button>,
  )
  fireEvent.click(screen.getByRole('button', { name: /保存/ }))
  expect(onClick).not.toHaveBeenCalled()
})
