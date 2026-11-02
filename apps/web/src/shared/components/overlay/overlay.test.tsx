import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import Modal from './Modal'
import SidePanel from './SidePanel'

const tick = () => act(() => new Promise((r) => setTimeout(r, 0)))

it('Modal ignores Escape while composing and closes once otherwise', () => {
  const onClose = vi.fn()
  render(<Modal open onClose={onClose} title="编辑黑板"><input aria-label="内容" /></Modal>)
  const input = screen.getByLabelText('内容')
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('Escape closes only the modal when another layer is open beneath it', () => {
  const below = vi.fn(), modal = vi.fn()
  function Below() { useEscapeLayer(true, below); return null }
  render(<><Below /><Modal open onClose={modal} title="积分榜">x</Modal></>)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(modal).toHaveBeenCalledTimes(1)
  expect(below).not.toHaveBeenCalled()
})

it('Modal portals into the fullscreen element while presenting', () => {
  const stage = document.createElement('div')
  document.body.appendChild(stage)
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage })
  try {
    render(<Modal open onClose={() => {}} title="积分榜">x</Modal>)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(stage).toContainElement(screen.getByRole('dialog', { name: '积分榜' }))
  } finally {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    stage.remove()
  }
})

it('closes on outside pointer down unless dismissOnOutside is false', async () => {
  const a = vi.fn(), b = vi.fn()
  const { unmount } = render(<Modal open onClose={a} title="积分榜">x</Modal>)
  await tick()
  fireEvent.pointerDown(document.body)
  expect(a).toHaveBeenCalledTimes(1)
  unmount()
  render(<Modal open onClose={b} title="编辑黑板" dismissOnOutside={false}>x</Modal>)
  await tick()
  fireEvent.pointerDown(document.body)
  expect(b).not.toHaveBeenCalled()
})

it('labels the built-in close button 关闭 and marks the dialog modal', () => {
  const onClose = vi.fn()
  render(<Modal open onClose={onClose} title="积分榜">x</Modal>)
  expect(screen.getByRole('dialog', { name: '积分榜' })).toHaveAttribute('aria-modal', 'true')
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('SidePanel restores focus to the opener on close', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <>
      <button type="button" onClick={() => setOpen(true)}>打开档案</button>
      {open && <SidePanel open onClose={() => setOpen(false)} title="王小一"><button type="button">内部</button></SidePanel>}
    </>
  }
  render(<Harness />)
  const opener = screen.getByRole('button', { name: '打开档案' })
  opener.focus()
  fireEvent.click(opener)
  await tick()
  expect(screen.getByRole('dialog', { name: '王小一' })).toContainElement(document.activeElement as HTMLElement)
  fireEvent.keyDown(document, { key: 'Escape' })
  await tick()
  expect(opener).toHaveFocus()
})

it('Modal restores focus to the opener even when content autofocuses', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <>
      <button type="button" onClick={() => setOpen(true)}>打开冲突</button>
      {open && <Modal open onClose={() => setOpen(false)} title="冲突"><button type="button" autoFocus>继续编辑</button></Modal>}
    </>
  }
  render(<Harness />)
  const opener = screen.getByRole('button', { name: '打开冲突' })
  opener.focus()
  fireEvent.click(opener)
  await tick()
  expect(screen.getByRole('dialog', { name: '冲突' })).toContainElement(document.activeElement as HTMLElement)
  fireEvent.keyDown(document, { key: 'Escape' })
  await tick()
  expect(opener).toHaveFocus()
})
