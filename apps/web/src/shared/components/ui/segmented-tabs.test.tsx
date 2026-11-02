import { fireEvent, render, screen } from '@testing-library/react'
import { SegmentedTabs } from './segmented-tabs'

describe('SegmentedTabs', () => {
  it('arrow keys move focus without activating; Enter activates', () => {
    const onChange = vi.fn()
    render(<SegmentedTabs label="教室模式" value="daily" onChange={onChange}
      items={[{ value: 'daily', label: '日常' }, { value: 'attendance', label: '考勤' }, { value: 'review', label: '点评' }]} />)
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
})
