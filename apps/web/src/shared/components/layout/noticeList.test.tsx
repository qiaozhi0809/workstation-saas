import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { InboxItem } from '@/shared/types/admin'
import NoticeList from './NoticeList'

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'n1',
  title: '账号安全提醒',
  content: '正文',
  from_name: null,
  created_at: '2026-11-04T01:00:00Z',
  read_at: null,
  recalled: false,
  ack: { kind: 'none' },
  ack_deadline: null,
  my_ack: null,
  students_detail: [],
  can_ack: false,
  ack_block_reason: null,
  ...over,
})
afterEach(cleanup)

it('shows 系统 for system notices', () => {
  render(<NoticeList items={[item()]} unread={1} onRead={vi.fn()} onReadAll={vi.fn()} />)
  expect(screen.getByText(/^系统 · /)).toBeInTheDocument()
})

it('shows 系统 for recalled system notices too', () => {
  render(
    <NoticeList
      items={[item({ recalled: true })]}
      unread={0}
      onRead={vi.fn()}
      onReadAll={vi.fn()}
    />,
  )
  expect(screen.getByText(/^系统 · /)).toBeInTheDocument()
})
