import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

describe('Markdown', () => {
  it('renders headings, lists and GFM tables', () => {
    const { container } = render(
      <Markdown text={'# 标题\n\n#### 小节\n\n- 甲\n- 乙\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />,
    )
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h3')?.textContent).toBe('标题')
    expect(container.querySelector('h4')?.textContent).toBe('小节')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })

  it('does not render raw HTML', () => {
    const { container } = render(<Markdown text="<script>alert(1)</script><b>x</b>" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })

  it('wraps tables for horizontal scroll', () => {
    const { container } = render(<Markdown text={'| a |\n| - |\n| 1 |'} />)
    const wrap = container.querySelector('table')?.parentElement
    expect(wrap?.className).toContain('overflow-x-auto')
  })

  it('opens links in a new tab safely', () => {
    const { container } = render(<Markdown text="[x](https://example.com)" />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
