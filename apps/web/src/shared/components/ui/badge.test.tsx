import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

it('renders its children', () => {
  render(<Badge variant="success">状态</Badge>)
  expect(screen.getByText('状态')).toBeInTheDocument()
})
