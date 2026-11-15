import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import UnseatedTray from './UnseatedTray'
import type { DraftStudent } from './draft'

const student = (id: string, name: string): DraftStudent =>
  ({ enrollmentId: id, name, gender: 'M', locked: false }) as unknown as DraftStudent

const tray = (over: Partial<Parameters<typeof UnseatedTray>[0]> = {}) =>
  render(
    <UnseatedTray
      students={[student('e1', '张小三'), student('e2', '赵小四')]}
      selectedId="e1"
      canUnseat={false}
      busy={false}
      seedOf={(id) => id}
      onSelect={vi.fn()}
      onUnseat={vi.fn()}
      {...over}
    />,
  )

it('shows the count in an Arc Badge, not a badgeVariants span', () => {
  tray()
  const heading = screen.getByRole('heading', { name: '待安排 (2)' })
  expect(within(heading).getByText('(2)')).toBeInTheDocument()
  // badgeVariants 的 neutral 是 bg-muted text-muted-foreground,Arc Badge 不带这两个类
  expect(heading.querySelector('.bg-muted, .rounded-md')).toBeNull()
})

it('is a muted block without a border and a medium-weight heading', () => {
  tray()
  const region = screen.getByRole('region', { name: '待安排 (2)' })
  expect(region.classList.contains('bg-muted')).toBe(true)
  expect(region.classList.contains('border')).toBe(false)
  expect(
    screen.getByRole('heading', { name: '待安排 (2)' }).classList.contains('font-semibold'),
  ).toBe(false)
})

it('draws each student as a 32px rounded-sm chip that keeps aria-pressed', () => {
  const onSelect = vi.fn()
  tray({ onSelect })
  const chip = screen.getByRole('button', { name: /张小三/ })
  expect(chip.classList.contains('rounded-sm')).toBe(true)
  expect(chip.classList.contains('rounded-full')).toBe(false)
  expect(chip.classList.contains('h-8')).toBe(true)
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /赵小四/ })).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(screen.getByRole('button', { name: /赵小四/ }))
  expect(onSelect).toHaveBeenCalledWith('e2')
})
