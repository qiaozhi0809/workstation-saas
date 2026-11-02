import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Link, MemoryRouter, Outlet, Route, RouterProvider, Routes } from 'react-router-dom'
import { findLegacyStyles } from '@/test/legacyStyles'
import AppShell from './AppShell'

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <AppShell home="/a" context={<span>三年二班</span>}
        actions={(layout) => <Link to="/b" data-layout={layout}>我的偏好</Link>}>
        <Routes><Route path="/a" element={<p>A 页</p>} /><Route path="/b" element={<p>B 页</p>} /></Routes>
      </AppShell>
    </MemoryRouter>,
  )
}

it('has a skip link to the focusable main region', () => {
  renderShell()
  expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#main')
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
})

it('menu button opens the actions in a panel and closes on navigation', async () => {
  renderShell()
  fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
  const menu = await screen.findByRole('dialog', { name: '菜单' })
  const link = within(menu).getByRole('link', { name: '我的偏好' })
  expect(link).toHaveAttribute('data-layout', 'menu')
  fireEvent.click(link)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '菜单' })).not.toBeInTheDocument())
  expect(screen.getByText('B 页')).toBeInTheDocument()
})

it('skip link moves focus to main without a hash navigation', () => {
  renderShell()
  const notPrevented = fireEvent.click(screen.getByRole('link', { name: '跳到主要内容' }))
  expect(notPrevented).toBe(false)
  expect(screen.getByRole('main')).toHaveFocus()
})

it('menu button reports its expanded state and gets focus back when the menu closes', async () => {
  renderShell()
  const button = screen.getByRole('button', { name: '打开菜单' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  button.focus()
  fireEvent.click(button)
  const menu = await screen.findByRole('dialog', { name: '菜单' })
  expect(button).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(within(menu).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '菜单' })).not.toBeInTheDocument())
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(button).toHaveFocus()
})

it('does not reopen the menu when navigating back to where it was opened', async () => {
  const router = createMemoryRouter([{
    element: (
      <AppShell home="/a" actions={(layout) => <Link to="/b" data-layout={layout}>我的偏好</Link>}>
        <Outlet />
      </AppShell>
    ),
    children: [{ path: '/a', element: <p>A 页</p> }, { path: '/b', element: <p>B 页</p> }],
  }], { initialEntries: ['/a'] })
  render(<RouterProvider router={router} />)
  fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
  fireEvent.click(within(await screen.findByRole('dialog', { name: '菜单' })).getByRole('link', { name: '我的偏好' }))
  await screen.findByText('B 页')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '菜单' })).not.toBeInTheDocument())
  await act(() => router.navigate(-1))
  expect(await screen.findByText('A 页')).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: '菜单' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开菜单' })).toHaveAttribute('aria-expanded', 'false')
})

it('uses design tokens only', () => {
  const files = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})
