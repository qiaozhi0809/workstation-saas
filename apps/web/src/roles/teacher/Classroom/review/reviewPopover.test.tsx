import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { rosterFixture } from '../pageTestUtils'
import ReviewPopover from './ReviewPopover'

const popover = () =>
  render(
    <ReviewPopover
      seat={rosterFixture[0]}
      anchor={{ left: 100, top: 100, width: 40, height: 40 }}
      stage={{ w: 800, h: 500 }}
      reasons={[]}
      subject={{ subjects: [], value: '', required: false, set: vi.fn() }}
      pending={false}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
    />,
  )

it('点评浮层用浮层阴影、没有边框', () => {
  popover()
  const dialog = screen.getByRole('dialog', { name: `点评 ${rosterFixture[0].name}` })
  expect(dialog.classList.contains('rounded-lg')).toBe(true)
  expect(dialog.classList.contains('shadow-overlay')).toBe(true)
  expect(dialog.classList.contains('border')).toBe(false)
  expect(dialog.classList.contains('shadow-lg')).toBe(false)
})

it('关闭按钮是 32 的图标按钮,输入框用小号', () => {
  popover()
  const close = screen.getByRole('button', { name: '关闭' })
  expect(close.classList.contains('h-8')).toBe(true)
  expect(close.classList.contains('w-8')).toBe(true)
  expect(close.classList.contains('h-7')).toBe(false)
  expect(screen.getByRole('textbox', { name: '理由' }).classList.contains('h-8')).toBe(true)
})
