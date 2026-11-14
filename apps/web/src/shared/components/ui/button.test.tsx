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
  expect(screen.getByRole('button', { name: '小图标' })).toHaveClass('h-8', 'w-8')
  expect(screen.getByRole('button', { name: '触控' })).toHaveClass('min-h-11', 'min-w-11')
})

it('link variant is a native button with type=button', () => {
  render(<Button variant="link">更多</Button>)
  const el = screen.getByRole('button', { name: '更多' })
  expect(el).toHaveAttribute('type', 'button')
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

it('asChild marks the child busy and swallows clicks while loading', () => {
  const onClick = vi.fn()
  render(
    <Button asChild loading onClick={onClick}>
      <a href="/x">去</a>
    </Button>,
  )
  const link = screen.getByRole('link', { name: '去' })
  expect(link).toHaveAttribute('aria-busy', 'true')
  expect(link).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(link)
  expect(onClick).not.toHaveBeenCalled()
})

it('native branch: loading wins over a caller aria-busy / aria-disabled', () => {
  render(
    <Button variant="link" loading aria-busy={false} aria-disabled={false}>
      更多
    </Button>,
  )
  const el = screen.getByRole('button', { name: '更多' })
  expect(el).toHaveAttribute('aria-busy', 'true')
  expect(el).toHaveAttribute('aria-disabled', 'true')
})
