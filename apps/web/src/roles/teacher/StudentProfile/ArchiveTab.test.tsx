import { render, screen } from '@testing-library/react'
import ArchiveTab from './ArchiveTab'

it('shows 暂无 placeholder when optional fields are missing', () => {
  render(<ArchiveTab student={{ id: 's', enrollment_id: 'e1', mk: 'S0002', name: '李小二', class_id: 'c' }} />)
  expect(screen.getAllByText('暂无').length).toBe(6)
  expect(screen.queryByText(/null|undefined/)).toBeNull()
})

it('treats blank strings as missing', () => {
  render(<ArchiveTab student={{ id: 's', enrollment_id: 'e1', mk: 'S0002', name: '李小二', class_id: 'c',
    family_structure: '   ' }} />)
  expect(screen.getAllByText('暂无').length).toBe(6)
})
