import { fireEvent, render, screen, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import AppShell from './AppShell'

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <AppShell home="/a" context={<span>三年二班</span>} actions={<Link to="/b">我的偏好</Link>}>
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

it('skip link moves focus to main without a hash navigation', () => {
  renderShell()
  const notPrevented = fireEvent.click(screen.getByRole('link', { name: '跳到主要内容' }))
  expect(notPrevented).toBe(false)
  expect(screen.getByRole('main')).toHaveFocus()
})

it('shows the brand as an icon link named 班级工作台 and keeps actions in the header at every width', () => {
  renderShell()
  const brand = screen.getByRole('link', { name: '班级工作台' })
  expect(brand).toHaveAttribute('href', '/a')
  expect(brand).toHaveTextContent('')
  expect(within(screen.getByRole('banner')).getByRole('link', { name: '我的偏好' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '打开菜单' })).toBeNull()
})
