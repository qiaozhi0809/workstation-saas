import { fireEvent, render, screen } from '@testing-library/react'
import { SegmentedTabs } from './segmented-tabs'

describe('SegmentedTabs', () => {
  it('arrow keys move focus without activating; Enter activates', () => {
    const onChange = vi.fn()
    render(
      <SegmentedTabs
        label="教室模式"
        value="daily"
        onChange={onChange}
        items={[
          { value: 'daily', label: '日常' },
          { value: 'attendance', label: '考勤' },
          { value: 'review', label: '点评' },
        ]}
      />,
    )
    const [daily, att, review] = screen.getAllByRole('tab')
    expect(daily).toHaveAttribute('tabindex', '0')
    expect(att).toHaveAttribute('tabindex', '-1')
    daily.focus()
    fireEvent.keyDown(daily, { key: 'ArrowLeft' })
    expect(review).toHaveFocus()
    fireEvent.keyDown(review, { key: 'Home' })
    expect(daily).toHaveFocus()
    fireEvent.keyDown(daily, { key: 'ArrowRight' })
    expect(att).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(att)
    expect(onChange).toHaveBeenCalledWith('attendance')
    fireEvent.click(daily)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  const items = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
    { value: 'c', label: '丙' },
  ]

  it('End moves focus to the last tab', () => {
    render(<SegmentedTabs label="x" value="a" onChange={() => {}} items={items} />)
    const tabs = screen.getAllByRole('tab')
    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(tabs[2]).toHaveFocus()
  })

  it('ArrowRight on the last tab wraps to the first', () => {
    render(<SegmentedTabs label="x" value="a" onChange={() => {}} items={items} />)
    const tabs = screen.getAllByRole('tab')
    tabs[2].focus()
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })
    expect(tabs[0]).toHaveFocus()
  })

  it('makes the first tab tabbable when no tab is selected', () => {
    render(<SegmentedTabs label="x" value={'zzz' as 'a'} onChange={() => {}} items={items} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    expect(tabs[2]).toHaveAttribute('tabindex', '-1')
  })

  it('underline variant: unselected tab has a transparent border', () => {
    render(
      <SegmentedTabs label="x" variant="underline" value="a" onChange={() => {}} items={items} />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs[1]).toHaveClass('border-transparent')
    expect(tabs[0]).toHaveClass('border-primary')
    expect(tabs[0]).not.toHaveClass('border-transparent')
  })
})
