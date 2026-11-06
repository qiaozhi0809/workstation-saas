import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Button } from './button'

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
