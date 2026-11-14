import { render, screen } from '@testing-library/react'
import { Card, CardContent, CardTitle } from './card'

it('Card is a borderless surface', () => {
  render(<Card data-testid="c">x</Card>)
  const el = screen.getByTestId('c')
  expect(el).toHaveAttribute('data-slot', 'card')
  expect(el).not.toHaveClass('border')
  expect(el).toHaveClass('shadow-surface', 'rounded-lg')
})

it('CardTitle is medium weight without tight tracking', () => {
  render(<CardTitle>标题</CardTitle>)
  const el = screen.getByText('标题')
  expect(el).toHaveClass('font-medium')
  expect(el).not.toHaveClass('font-semibold')
  expect(el).not.toHaveClass('tracking-tight')
})

it('CardContent keeps p-6 pt-0', () => {
  render(<CardContent>正文</CardContent>)
  expect(screen.getByText('正文')).toHaveClass('p-6', 'pt-0')
})
