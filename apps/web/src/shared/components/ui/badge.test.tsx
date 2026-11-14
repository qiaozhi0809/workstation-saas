import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

it('renders its children', () => {
  render(<Badge variant="success">状态</Badge>)
  expect(screen.getByText('状态')).toBeInTheDocument()
})

// 用真的 Arc Badge:文字变了以后旧文字不能还留在 DOM 里(教师 AI 批量页的「排队中」→「生成中」)
it('does not keep the old text in the DOM after the text changes', () => {
  const { rerender } = render(<Badge variant="neutral">排队中</Badge>)
  expect(screen.getAllByText('排队中')).toHaveLength(1)
  rerender(<Badge variant="neutral">生成中</Badge>)
  expect(screen.getAllByText('生成中')).toHaveLength(1)
  expect(screen.queryByText('排队中')).toBeNull()
})
