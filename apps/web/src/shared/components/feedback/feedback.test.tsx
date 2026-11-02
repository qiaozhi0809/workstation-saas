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
    render(<EmptyState icon={Inbox} title="没有数据" description="先添加一些" action={<button>添加</button>} />)
    expect(screen.getByText('没有数据')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '没有数据' })).toBeInTheDocument()
    expect(screen.getByText('先添加一些')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument()
  })
})
