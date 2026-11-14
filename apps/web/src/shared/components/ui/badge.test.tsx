import { render, screen } from '@testing-library/react'
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
] as const)('maps %s to arc tone %s', (variant, tone) => {
  render(<Badge variant={variant}>状态</Badge>)
  expect(screen.getByText('状态').closest('[data-tone]')).toHaveAttribute('data-tone', tone)
})

it('outline maps to a neutral outlined arc badge, never a pill', () => {
  render(<Badge variant="outline">描边</Badge>)
  const root = screen.getByText('描边').closest('[data-tone]') as HTMLElement
  expect(root).toHaveAttribute('data-tone', 'neutral')
  expect(root).toHaveAttribute('data-outline', 'true')
  expect(root).not.toHaveAttribute('data-pill')
})

it('defaults to the neutral tone', () => {
  render(<Badge>默认</Badge>)
  expect(screen.getByText('默认').closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral')
})
