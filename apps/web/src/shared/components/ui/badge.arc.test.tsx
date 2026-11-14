import { forwardRef, type HTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

// 替身把 Arc Badge 收到的 props 写到 data-arc-*;没传的属性保持缺省,所以能断言 pill 没被传
vi.mock('@/shared/components/arc/badge/badge', () => ({
  Badge: forwardRef<
    HTMLSpanElement,
    HTMLAttributes<HTMLSpanElement> & {
      tone?: string
      outline?: boolean
      pill?: boolean
      size?: string
    }
  >(function ArcBadgeStub({ tone, outline, pill, size, ...rest }, ref) {
    return (
      <span
        ref={ref}
        data-arc-tone={tone}
        data-arc-outline={outline === undefined ? undefined : String(outline)}
        data-arc-pill={pill === undefined ? undefined : String(pill)}
        data-arc-size={size}
        {...rest}
      />
    )
  }),
}))

import { Badge } from './badge'

it.each([
  ['default', 'neutral'],
  ['secondary', 'neutral'],
  ['neutral', 'neutral'],
  ['success', 'success'],
  ['warning', 'warning'],
  ['info', 'info'],
  ['danger', 'danger'],
  ['destructive', 'danger'],
] as const)('maps %s to arc tone %s, not outlined', (variant, tone) => {
  render(<Badge variant={variant}>状态</Badge>)
  const el = screen.getByText('状态')
  expect(el).toHaveAttribute('data-arc-tone', tone)
  expect(el).toHaveAttribute('data-arc-outline', 'false')
  expect(el).not.toHaveAttribute('data-arc-pill')
})

it('outline maps to a neutral outlined arc badge, never a pill', () => {
  render(<Badge variant="outline">描边</Badge>)
  const el = screen.getByText('描边')
  expect(el).toHaveAttribute('data-arc-tone', 'neutral')
  expect(el).toHaveAttribute('data-arc-outline', 'true')
  expect(el).not.toHaveAttribute('data-arc-pill')
})

it('defaults to the neutral tone', () => {
  render(<Badge>默认</Badge>)
  expect(screen.getByText('默认')).toHaveAttribute('data-arc-tone', 'neutral')
})
