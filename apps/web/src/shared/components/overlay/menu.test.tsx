import type { KeyboardEvent } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Menu, { MenuItem, MenuLinkItem } from './Menu'

function Where() {
  return <output aria-label="当前地址">{useLocation().pathname}</output>
}

function renderMenu(onTriggerKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void) {
  return render(
    <MemoryRouter>
      <Menu
        label="更多操作"
        trigger="⋯"
        triggerProps={{ 'aria-label': '更多操作', onKeyDown: onTriggerKeyDown }}
      >
        <MenuItem onSelect={vi.fn()}>放弃修改</MenuItem>
        <MenuItem onSelect={vi.fn()}>固定座位</MenuItem>
        <MenuLinkItem to="/teacher/preferences">我的偏好</MenuLinkItem>
      </Menu>
      <Where />
    </MemoryRouter>,
  )
}

const trigger = () => screen.getByRole('button', { name: '更多操作' })
const items = () => within(screen.getByRole('menu', { name: '更多操作' })).getAllByRole('menuitem')

// L276:APG 菜单按钮——↑ 打开时焦点落在最后一项(↓ 仍落在第一项);菜单开着时在触发按钮上按 ↑ / ↓ 也分别跳到末项 / 首项
it('arrow up opens focusing last item', () => {
  renderMenu()
  const btn = trigger()
  btn.focus()
  expect(fireEvent.keyDown(btn, { key: 'ArrowUp' })).toBe(false) // 已 preventDefault:不滚动页面
  expect(btn).toHaveAttribute('aria-expanded', 'true')
  expect(items()[2]).toHaveFocus()
  btn.focus()
  fireEvent.keyDown(btn, { key: 'ArrowDown' })
  expect(items()[0]).toHaveFocus()
  btn.focus()
  fireEvent.keyDown(btn, { key: 'ArrowUp' })
  expect(items()[2]).toHaveFocus()
  expect(screen.getByRole('menu')).toBeInTheDocument()
})

it('arrow down still opens focusing the first item, and a click opens on the first item too', () => {
  renderMenu()
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
  expect(items()[0]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  // ↑ 打开过一次之后,点开仍然聚焦第一项(不记住上一次的"末项")
  fireEvent.keyDown(trigger(), { key: 'ArrowUp' })
  expect(items()[2]).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(trigger())
  expect(items()[0]).toHaveFocus()
})

it('leaves the arrow keys alone when the trigger handler already prevented default', () => {
  renderMenu((e) => {
    if (e.key === 'ArrowUp') e.preventDefault()
  })
  fireEvent.keyDown(trigger(), { key: 'ArrowUp' })
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
  expect(items()[0]).toHaveFocus()
})

// L276:菜单项是链接时浏览器只把回车当激活,空格只滚动页面;现在空格也激活(原先由 AdminNav 的包裹层处理)
it('space activates a link item: navigates, closes and returns focus to the trigger', () => {
  renderMenu()
  fireEvent.click(trigger())
  const link = screen.getByRole('menuitem', { name: '我的偏好' })
  link.focus()
  expect(fireEvent.keyDown(link, { key: ' ' })).toBe(false)
  expect(screen.getByLabelText('当前地址')).toHaveTextContent('/teacher/preferences')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger()).toHaveFocus()
})
