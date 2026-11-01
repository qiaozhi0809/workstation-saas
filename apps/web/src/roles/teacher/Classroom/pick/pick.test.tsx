import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attendanceApi } from '@/shared/api/attendance'
import { reviewsApi } from '@/shared/api/reviews'
import { defaultApiMocks, rosterFixture, setup } from '../pageTestUtils'
import { spinDelays } from './pickLogic'

vi.mock('@/shared/api/classes')
vi.mock('@/shared/api/students')
vi.mock('@/shared/api/classroom')
vi.mock('@/shared/api/attendance')
vi.mock('@/shared/api/reviews')
vi.mock('@/shared/api/seating')
vi.mock('@/shared/api/todos')
vi.mock('@/shared/api/preferences')

const originalMatchMedia = window.matchMedia
const reduceMotion = () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} })
}

beforeEach(() => {
  vi.resetAllMocks()
  defaultApiMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.matchMedia = originalMatchMedia
})

it('spins then shows the picked student, skipping students on leave', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null,
    items: [{ enrollment_id: 'e1', status: 'leave', reason: null, marked_at: '' }] })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  expect(screen.getByRole('button', { name: '随机点名' })).toBeDisabled()
  await act(() => vi.advanceTimersByTimeAsync(spinDelays().reduce((a, b) => a + b, 0)))
  const card = await screen.findByRole('dialog', { name: '随机点名' })
  expect(within(card).getByText('李小二')).toBeInTheDocument()
  expect(within(card).getByText('学号 2026002')).toBeInTheDocument()
})

it('shows the empty message when nobody can be picked', async () => {
  vi.mocked(attendanceApi.day).mockResolvedValue({ date: '2026-11-02', confirmed_at: null,
    items: ['e1', 'e2', 'e3'].map((id) => ({ enrollment_id: id, status: 'leave' as const, reason: null, marked_at: '' })) })
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  expect(await screen.findByText('今天没有可点名的同学')).toBeInTheDocument()
  const card = screen.getByRole('dialog', { name: '随机点名' })
  expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['关闭'])
})

it('picks immediately with reduced motion and rewards the answer', async () => {
  reduceMotion()
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  fireEvent.click(await screen.findByRole('button', { name: '回答得好 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    category: 'individual', reason_text: '回答问题', score_delta: 1 })))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '随机点名' })).toBeNull())
})

it('rewards only once when the button is double-clicked', async () => {
  reduceMotion()
  let resolve!: (v: { items: [] }) => void
  vi.mocked(reviewsApi.create).mockReturnValue(new Promise((r) => { resolve = r }))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  const btn = await screen.findByRole('button', { name: '回答得好 +1' })
  fireEvent.click(btn)
  fireEvent.click(btn)
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(1))
  await act(async () => resolve({ items: [] }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '随机点名' })).toBeNull())
})

it('hides the reward button without review.write', async () => {
  reduceMotion()
  setup({ perms: ['attendance.read'] })
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  const card = await screen.findByRole('dialog', { name: '随机点名' })
  expect(within(card).queryByRole('button', { name: '回答得好 +1' })).toBeNull()
  expect(within(card).getByRole('button', { name: '再抽一个' })).toBeInTheDocument()
})

it('closes the card with Escape', async () => {
  reduceMotion()
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  await screen.findByRole('dialog', { name: '随机点名' })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '随机点名' })).toBeNull()
})

it('reuses the op id when a reward is retried after an ambiguous failure', async () => {
  reduceMotion()
  vi.mocked(reviewsApi.create).mockRejectedValueOnce(new TypeError('Failed to fetch'))
  setup()
  fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
  const btn = await screen.findByRole('button', { name: '回答得好 +1' })
  fireEvent.click(btn)
  expect(await screen.findByText('Failed to fetch')).toBeInTheDocument()
  await waitFor(() => expect(btn).toBeEnabled())
  fireEvent.click(btn)
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledTimes(2))
  const ids = vi.mocked(reviewsApi.create).mock.calls.map((c) => c[1].op_id)
  expect(ids[1]).toBe(ids[0])
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '随机点名' })).toBeNull())
})

it('rewards in the subject last chosen in the review popover', async () => {
  setup({ mode: '点评', subjects: ['物理', '化学'], perms: ['attendance.read', 'review.read', 'review.write'] })
  fireEvent.click(await screen.findByRole('button', { name: '王小一' }))
  fireEvent.change(await screen.findByLabelText('科目'), { target: { value: '化学' } })
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  reduceMotion()
  fireEvent.click(screen.getByRole('button', { name: '随机点名' }))
  fireEvent.click(await screen.findByRole('button', { name: '回答得好 +1' }))
  await waitFor(() => expect(reviewsApi.create).toHaveBeenCalledWith('c1', expect.objectContaining({
    reason_text: '回答问题', subject: '化学' })))
})

it('shows only the name on the card while presenting', async () => {
  // 减少动态时不转动,不需要假时钟(全屏切换后地图的适应缩放走真实定时器)
  vi.useRealTimers()
  reduceMotion()
  const request = Element.prototype.requestFullscreen
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  try {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    setup({ roster: rosterFixture.map((s) => (s.enrollment_id === 'e1' ? { ...s, class_role: '班长' } : s)) })
    fireEvent.click(await screen.findByRole('button', { name: '全屏' }))
    await screen.findByRole('button', { name: '退出全屏' })
    fireEvent.click(await screen.findByRole('button', { name: '随机点名' }))
    const card = await screen.findByRole('dialog', { name: '随机点名' })
    expect(within(card).getByText('王小一')).toBeInTheDocument()
    expect(within(card).queryByText('学号 2026001')).toBeNull()
    expect(within(card).queryByText('班长')).toBeNull()
  } finally {
    Element.prototype.requestFullscreen = request
    delete (document as { fullscreenElement?: Element | null }).fullscreenElement
  }
})
