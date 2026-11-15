import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

// 替身把 Arc Button 收到的 props 原样写到 data-arc-*,断言的就是适配层真正传给 Arc 的值
vi.mock('@/shared/components/arc/button/button', () => ({
  Button: forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string
      size?: string
      loading?: boolean
    }
  >(function ArcButtonStub({ variant, size, loading, ...rest }, ref) {
    return (
      <button
        ref={ref}
        data-arc-variant={variant}
        data-arc-size={size}
        data-arc-loading={loading === undefined ? undefined : String(loading)}
        {...rest}
      />
    )
  }),
}))

import { Button } from './button'

it.each([
  ['default', 'primary'],
  ['outline', 'secondary'],
  ['secondary', 'secondary'],
  ['ghost', 'ghost'],
  ['destructive', 'danger'],
] as const)('maps variant %s to arc %s', (variant, arc) => {
  render(<Button variant={variant}>按钮</Button>)
  expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('data-arc-variant', arc)
})

it.each([
  ['default', 'md'],
  ['sm', 'sm'],
  ['lg', 'lg'],
] as const)('maps size %s to arc %s', (size, arc) => {
  render(<Button size={size}>按钮</Button>)
  expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('data-arc-size', arc)
})

it('defaults to variant primary, size md, type=button', () => {
  render(<Button>按钮</Button>)
  const el = screen.getByRole('button', { name: '按钮' })
  expect(el).toHaveAttribute('data-arc-variant', 'primary')
  expect(el).toHaveAttribute('data-arc-size', 'md')
  expect(el).toHaveAttribute('type', 'button')
})

it('forwards loading to arc', () => {
  render(<Button loading>按钮</Button>)
  expect(screen.getByRole('button', { name: '按钮' })).toHaveAttribute('data-arc-loading', 'true')
})

it.each([
  ['link', {}],
  ['default', { size: 'icon' }],
  ['default', { size: 'icon-sm' }],
  ['default', { size: 'touch' }],
] as const)('project-rendered %s %j never reaches arc', (variant, extra) => {
  render(
    <Button variant={variant} {...extra}>
      按钮
    </Button>,
  )
  const el = screen.getByRole('button', { name: '按钮' })
  expect(el).not.toHaveAttribute('data-arc-variant')
  expect(el).not.toHaveAttribute('data-arc-size')
})

it('asChild never reaches arc', () => {
  render(
    <Button asChild>
      <a href="/x">去</a>
    </Button>,
  )
  expect(screen.getByRole('link', { name: '去' })).not.toHaveAttribute('data-arc-variant')
})

// G-CR-2:Arc Button 不管子图标尺寸,lucide 默认 24px。适配层给 Arc 路径挂 ws-btn,
// arc-overrides.css 用零特异性规则把没写尺寸的图标收到 16px(vitest 不加载 CSS,直接读文件)
it('arc path buttons carry ws-btn so their icons are scaled to 16px', () => {
  render(
    <Button className="extra">
      <svg data-testid="icon" aria-hidden="true" />
      按钮
    </Button>,
  )
  const btn = screen.getByRole('button', { name: '按钮' })
  expect(btn).toHaveClass('ws-btn', 'extra')
  const css = readFileSync('src/theme/arc-overrides.css', 'utf8')
  expect(css).toMatch(/:where\(\.ws-btn\) svg\s*\{[^}]*width: 1rem;[^}]*height: 1rem;/)
})
