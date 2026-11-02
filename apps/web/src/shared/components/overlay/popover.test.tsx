import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Menu, { MenuItem, MenuLabel, MenuLinkItem } from './Menu'
import Popover from './Popover'

function Where() {
  return <output aria-label="当前地址">{useLocation().pathname}</output>
}

function renderMenu(onA = vi.fn()) {
  return render(
    <MemoryRouter>
      <Menu label="更多操作" trigger="⋯" triggerProps={{ 'aria-label': '更多操作' }}>
        <MenuLabel>王老师</MenuLabel>
        <MenuItem onSelect={onA}>放弃修改</MenuItem>
        <MenuItem onSelect={vi.fn()} disabled>固定座位</MenuItem>
        <MenuLinkItem to="/teacher/preferences">我的偏好</MenuLinkItem>
      </Menu>
      <button>外面</button>
      <Where />
    </MemoryRouter>,
  )
}

const menuTrigger = () => screen.getByRole('button', { name: '更多操作' })

it('menu button opens with focus on the first item and moves with arrow keys', () => {
  renderMenu()
  const trigger = menuTrigger()
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const items = within(screen.getByRole('menu', { name: '更多操作' })).getAllByRole('menuitem')
  expect(items.map((i) => i.textContent)).toEqual(['放弃修改', '固定座位', '我的偏好'])
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(items[0], { key: 'ArrowUp' })
  expect(items[2]).toHaveFocus()
  fireEvent.keyDown(items[2], { key: 'Home' })
  expect(items[0]).toHaveFocus()
  expect(items[2]).toHaveAttribute('href', '/teacher/preferences')
})

it('arrow keys cycle forward, End jumps last, and ArrowDown on the trigger opens the menu', () => {
  renderMenu()
  const trigger = menuTrigger()
  // Enter / Space 由原生 button 转成 click;↓ 要自己处理
  expect(fireEvent.keyDown(trigger, { key: 'ArrowDown' })).toBe(false)
  const items = screen.getAllByRole('menuitem')
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(items[0], { key: 'ArrowDown' })
  expect(items[1]).toHaveFocus() // aria-disabled 的项也能聚焦
  fireEvent.keyDown(items[1], { key: 'End' })
  expect(items[2]).toHaveFocus()
  fireEvent.keyDown(items[2], { key: 'ArrowDown' })
  expect(items[0]).toHaveFocus()
  items.forEach((i) => expect(i).toHaveAttribute('tabindex', '-1'))
})

it('trigger always points at the layer with aria-controls', () => {
  renderMenu()
  const trigger = menuTrigger()
  const id = trigger.getAttribute('aria-controls')
  expect(id).toBeTruthy()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(screen.getByRole('menu')).toHaveAttribute('id', id)
})

it('Escape closes the menu and returns focus to the trigger, but not while composing', () => {
  renderMenu()
  const trigger = menuTrigger()
  fireEvent.click(trigger)
  const first = screen.getAllByRole('menuitem')[0]
  fireEvent.keyDown(first, { key: 'Escape', isComposing: true })
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.keyDown(first, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('selecting an item runs it, closes and returns focus; aria-disabled items do nothing', () => {
  const onA = vi.fn()
  renderMenu(onA)
  const trigger = menuTrigger()
  fireEvent.click(trigger)
  const fixed = screen.getByRole('menuitem', { name: '固定座位' })
  expect(fixed).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(fixed)
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: '放弃修改' }))
  expect(onA).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('a link item navigates, closes and returns focus', () => {
  renderMenu()
  const trigger = menuTrigger()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: '我的偏好' }))
  expect(screen.getByLabelText('当前地址')).toHaveTextContent('/teacher/preferences')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('Tab closes the menu without blocking the browser from moving focus', () => {
  renderMenu()
  fireEvent.click(menuTrigger())
  const first = screen.getAllByRole('menuitem')[0]
  expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('a click outside closes without moving focus; clicking the trigger again closes', () => {
  renderMenu()
  const trigger = menuTrigger()
  fireEvent.click(trigger)
  const outside = screen.getByRole('button', { name: '外面' })
  fireEvent.click(outside)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).not.toHaveFocus()
  fireEvent.click(trigger)
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.click(trigger)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

function renderPopover(onBlur = vi.fn()) {
  return render(
    <>
      <Popover label="座位行列" trigger="6 排 × 4 列" side="top">
        <input aria-label="排数" onBlur={onBlur} />
        <span>说明</span>
      </Popover>
      <button>外面</button>
    </>,
  )
}

it('popover focuses its first field, stays open on clicks inside, closes when focus leaves it', () => {
  renderPopover()
  const trigger = screen.getByRole('button', { name: '6 排 × 4 列' })
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '座位行列' })
  expect(trigger).toHaveAttribute('aria-controls', dialog.id)
  expect(dialog).toHaveClass('bottom-full')
  const input = screen.getByLabelText('排数')
  expect(input).toHaveFocus()
  fireEvent.click(screen.getByText('说明'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.blur(input, { relatedTarget: null })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.blur(input, { relatedTarget: trigger }) // 回到触发按钮仍在组件内
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: '外面' }) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('Escape unmounts the popover before refocusing the trigger, so a blur-to-commit field never commits', () => {
  // W16:Esc 放弃未提交的输入。若先 focus 触发按钮再卸载,输入框会先失焦、触发提交
  const onBlur = vi.fn()
  renderPopover(onBlur)
  const trigger = screen.getByRole('button', { name: '6 排 × 4 列' })
  fireEvent.click(trigger)
  const input = screen.getByLabelText('排数')
  expect(input).toHaveFocus()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onBlur).not.toHaveBeenCalled()
  expect(trigger).toHaveFocus()
})

it('renders inside its own subtree, never in a portal', () => {
  const { container } = renderMenu()
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
  expect(container.contains(screen.getByRole('menu'))).toBe(true)
})

it('a drag that starts inside and is released outside keeps the popover open; a press outside still closes', () => {
  // 在排数框里拖选数字、松手在外面:click 落在共同祖先上,但输入框没失焦,不能直接卸载丢掉输入(W16)
  renderPopover()
  fireEvent.click(screen.getByRole('button', { name: '6 排 × 4 列' }))
  const input = screen.getByLabelText('排数')
  fireEvent.pointerDown(input)
  fireEvent.click(document.body)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(input).toHaveFocus()
  const outside = screen.getByRole('button', { name: '外面' })
  fireEvent.pointerDown(outside)
  fireEvent.click(outside)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('aria-disabled menu items get no hover highlight', () => {
  renderMenu()
  fireEvent.click(menuTrigger())
  const fixed = screen.getByRole('menuitem', { name: '固定座位' })
  expect(fixed).toHaveClass('aria-disabled:hover:bg-transparent', 'aria-disabled:hover:text-inherit')
})

it('popover focuses a [data-autofocus] element before the first focusable one', () => {
  render(
    <Popover label="座位行列" trigger="6 排 × 4 列">
      <button type="button">减少排数</button>
      <input aria-label="排数" data-autofocus />
    </Popover>,
  )
  fireEvent.click(screen.getByRole('button', { name: '6 排 × 4 列' }))
  expect(screen.getByLabelText('排数')).toHaveFocus()
})
