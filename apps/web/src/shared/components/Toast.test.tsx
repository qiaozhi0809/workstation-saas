import { act, fireEvent, render, screen } from '@testing-library/react'
import { Toaster, toast } from './Toast'

function fakeFullscreen(stage: HTMLElement | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => stage })
}

it('renders toasts inside the fullscreen element', () => {
  const stage = document.createElement('div')
  document.body.appendChild(stage)
  fakeFullscreen(stage)
  try {
    render(<Toaster />)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    act(() => { toast('已保存') })
    expect(stage).toHaveTextContent('已保存')
  } finally {
    fakeFullscreen(null)
    stage.remove()
  }
})

it('runs the action and dismisses', () => {
  const onClick = vi.fn()
  render(<Toaster />)
  act(() => { toast('已撤销', { action: { label: '恢复', onClick } }) })
  expect(screen.getByText('已撤销')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '恢复' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('已撤销')).not.toBeInTheDocument()
})
