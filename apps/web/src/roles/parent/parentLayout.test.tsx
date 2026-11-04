import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { parentApi } from '@/shared/api/parent'
import { child, mockWidth, renderParent, setParentUser, today } from './testkit'

vi.mock('@/shared/api/parent', () => ({
  parentApi: { children: vi.fn(), today: vi.fn(), profile: vi.fn(), saveContacts: vi.fn() },
}))

const two = [child(), child({ student_id: 's2', name: '王小二', class_name: '五年一班' })]
const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  vi.clearAllMocks()
  setParentUser()
  mockWidth(375)
  vi.mocked(parentApi.children).mockResolvedValue(two)
  vi.mocked(parentApi.today).mockResolvedValue(today())
})

it('puts the tabs at the bottom below 768 with safe-area padding, not in the top bar', async () => {
  renderParent()
  await screen.findByText('三年二班')
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['今日', '成长', '成绩'])
  expect(screen.getByRole('banner')).not.toContainElement(nav)
  expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]')
  for (const l of within(nav).getAllByRole('link')) expect(l.className).toMatch(/min-h-\[44px\]/)
})

it('moves the tabs into the top bar from 768', async () => {
  mockWidth(768)
  renderParent()
  await screen.findByText('三年二班')
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(screen.getByRole('banner')).toContainElement(nav)
})

it('lands on today with the first child written into ?child=', async () => {
  renderParent()
  await waitFor(() => expect(where()).toBe('/parent/today?child=s1'))
  expect(parentApi.today).toHaveBeenCalledWith('s1')
})

it('keeps the child in the tab links', async () => {
  renderParent('/parent/today?child=s2')
  const nav = await screen.findByRole('navigation', { name: '主导航' })
  expect(within(nav).getByRole('link', { name: '成长' })).toHaveAttribute('href', '/parent/growth?child=s2')
})

it('switching the child rewrites ?child= and refetches', async () => {
  renderParent('/parent/today?child=s1')
  await screen.findByText('三年二班')
  fireEvent.change(screen.getByRole('combobox', { name: '切换孩子' }), { target: { value: 's2' } })
  await waitFor(() => expect(where()).toBe('/parent/today?child=s2'))
  await waitFor(() => expect(parentApi.today).toHaveBeenCalledWith('s2'))
  expect(localStorage.getItem('ws-parent-child')).toBe('s2')
})

it('replaces an unknown ?child= with the first child', async () => {
  renderParent('/parent/today?child=nobody')
  await waitFor(() => expect(where()).toBe('/parent/today?child=s1'))
  expect(parentApi.today).not.toHaveBeenCalledWith('nobody')
})

it('falls back to the remembered child when the URL has none', async () => {
  localStorage.setItem('ws-parent-child', 's2')
  renderParent('/parent/today')
  await waitFor(() => expect(where()).toBe('/parent/today?child=s2'))
})

it('ignores a remembered child that is no longer bound', async () => {
  localStorage.setItem('ws-parent-child', 'gone')
  renderParent('/parent/today')
  await waitFor(() => expect(where()).toBe('/parent/today?child=s1'))
})

it('shows a plain name instead of a switcher for a single child, and links to the profile', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([child()])
  renderParent()
  await screen.findByText('三年二班')
  expect(screen.queryByRole('combobox', { name: '切换孩子' })).toBeNull()
  expect(screen.getByRole('link', { name: '档案' })).toHaveAttribute('href', '/parent/profile?child=s1')
})

it('shows the empty state when no child is bound', async () => {
  vi.mocked(parentApi.children).mockResolvedValue([])
  renderParent()
  expect(await screen.findByText('还没有绑定孩子,请联系班主任')).toBeInTheDocument()
  expect(parentApi.today).not.toHaveBeenCalled()
  expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull()
})

it('shows a retryable error when the child list fails', async () => {
  vi.mocked(parentApi.children).mockRejectedValueOnce(new Error('x')).mockResolvedValue(two)
  renderParent()
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(await screen.findByText('三年二班')).toBeInTheDocument()
})

it('sends a non-parent account away from /parent', () => {
  useAuthStoreAsTeacher()
  renderParent()
  expect(parentApi.children).not.toHaveBeenCalled()
})

import { useAuthStore } from '@/shared/stores/auth'
function useAuthStoreAsTeacher() {
  useAuthStore.setState({
    accessToken: 'a', refreshToken: 'r',
    user: { id: 'u', display_name: '陈老师', contexts: ['teacher'], admin_perms: [], must_change_password: false },
  })
}
