import { fireEvent, render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

describe('LoadingState', () => {
  it('has status role and default label', () => {
    render(<LoadingState />)
    expect(screen.getByRole('status')).toHaveTextContent('加载中…')
  })
  it('accepts a custom label', () => {
    render(<LoadingState label="读取中" />)
    expect(screen.getByRole('status')).toHaveTextContent('读取中')
  })
})

describe('LoadingState variants', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('table skeleton keeps row slots', () => {
    const { container } = render(<LoadingState variant="table" rows={5} label="读取成绩" />)
    expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(5)
    expect(screen.getByRole('status', { name: '读取成绩' })).toHaveAttribute('aria-busy', 'true')
  })

  it('cards skeleton renders three blocks', () => {
    const { container } = render(<LoadingState variant="cards" />)
    const cards = container.querySelectorAll('[data-skeleton-card]')
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card).toHaveClass('rounded-lg')
      expect(card.className).not.toContain('rounded-md')
    }
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('form skeleton uses arc skeleton', () => {
    render(<LoadingState variant="form" label="读取表单" />)
    const status = screen.getByRole('status', { name: '读取表单' })
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status.querySelectorAll('span[aria-hidden="true"] > span').length).toBeGreaterThan(0)
  })

  it('skeleton pulses by default', () => {
    const { container } = render(<LoadingState variant="table" rows={1} />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('skeleton stops under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const { container } = render(<LoadingState variant="table" rows={2} />)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})

describe('ErrorState', () => {
  it('has alert role and calls onRetry', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="出错了" description="请稍后" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('出错了')
    expect(screen.getByText('请稍后')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('disables the button while retrying', () => {
    render(<ErrorState title="出错了" onRetry={() => {}} retrying />)
    expect(screen.getByRole('button', { name: '重试' })).toBeDisabled()
  })
  it('has no button without onRetry', () => {
    render(<ErrorState title="出错了" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="没有数据"
        description="先添加一些"
        action={<button>添加</button>}
      />,
    )
    expect(screen.getByText('没有数据')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '没有数据' })).toBeInTheDocument()
    expect(screen.getByText('先添加一些')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
  })

  it('aligns start by default and centers on request', () => {
    const { container, rerender } = render(<EmptyState title="没有数据" />)
    expect(container.firstElementChild).toHaveClass('items-start', 'text-left')
    rerender(<EmptyState title="没有数据" align="center" />)
    expect(container.firstElementChild).toHaveClass('items-center', 'text-center')
  })
})
