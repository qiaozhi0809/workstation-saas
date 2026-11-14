import { render, screen } from '@testing-library/react'
import { Input } from './input'
import { NativeSelect } from './native-select'
import { Textarea } from './textarea'

it('Input is 40 high with 12 radius, 32 when small', () => {
  render(
    <>
      <Input aria-label="a" />
      <Input aria-label="b" controlSize="sm" />
    </>,
  )
  expect(screen.getByLabelText('a')).toHaveClass('h-10', 'rounded-md')
  expect(screen.getByLabelText('b')).toHaveClass('h-8')
  expect(screen.getByLabelText('b')).not.toHaveClass('h-10')
})

it('NativeSelect stays a combobox and is 40 high', () => {
  render(
    <NativeSelect aria-label="s">
      <option>一</option>
    </NativeSelect>,
  )
  const el = screen.getByRole('combobox', { name: 's' })
  expect(el.tagName).toBe('SELECT')
  expect(el).toHaveClass('h-10', 'rounded-md')
})

it('NativeSelect small is 32 high', () => {
  render(<NativeSelect aria-label="s" controlSize="sm" />)
  expect(screen.getByRole('combobox')).toHaveClass('h-8')
})

it('Textarea has 12 radius', () => {
  render(<Textarea aria-label="t" />)
  expect(screen.getByLabelText('t')).toHaveClass('rounded-md')
})
