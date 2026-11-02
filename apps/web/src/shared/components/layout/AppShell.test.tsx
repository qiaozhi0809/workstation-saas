import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
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

it('uses design tokens only', () => {
  const files = import.meta.glob(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true })
  expect(findLegacyStyles(files as Record<string, string>)).toEqual([])
})
