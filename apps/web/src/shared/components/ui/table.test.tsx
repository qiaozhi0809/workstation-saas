import { render, screen } from '@testing-library/react'
import { Table, TableBody, TableFoot, TableHead, TableRow, Td, Th } from './table'

function Sample(props: Partial<React.ComponentProps<typeof Table>>) {
  return (
    <Table {...props}>
      <TableHead>
        <TableRow>
          <Th>姓名</Th>
          <Th numeric>总分</Th>
          <Th align="end">操作</Th>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <Td>王小一</Td>
          <Td numeric>95.5</Td>
          <Td align="end">编辑</Td>
        </TableRow>
      </TableBody>
      <TableFoot>
        <TableRow>
          <Td>合计</Td>
          <Td numeric>95.5</Td>
          <Td />
        </TableRow>
      </TableFoot>
    </Table>
  )
}

describe('Table', () => {
  it('keeps native semantics', () => {
    render(<Sample />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
    expect(screen.getAllByRole('row')).toHaveLength(3)
    for (const th of screen.getAllByRole('columnheader')) expect(th).toHaveAttribute('scope', 'col')
  })

  it('numeric cells align right with tabular nums', () => {
    render(<Sample />)
    expect(screen.getByRole('columnheader', { name: '总分' })).toHaveClass(
      'text-right',
      'tabular-nums',
    )
    expect(screen.getAllByRole('cell', { name: '95.5' })[0]).toHaveClass(
      'text-right',
      'tabular-nums',
    )
  })

  it('align end for action column', () => {
    render(<Sample />)
    const cell = screen.getByRole('cell', { name: '编辑' })
    expect(cell).toHaveClass('text-right')
    expect(cell).not.toHaveClass('tabular-nums')
  })

  it('text cells do not wrap and header is 40 high', () => {
    render(<Sample />)
    expect(screen.getByRole('cell', { name: '王小一' })).toHaveClass('whitespace-nowrap', 'px-3')
    expect(screen.getByRole('columnheader', { name: '姓名' })).toHaveClass('h-10', 'px-3')
  })

  it('minWidth wraps in a scroller', () => {
    const { container } = render(<Sample minWidth={896} />)
    const scroller = container.querySelector('[data-table-scroll]')
    expect(scroller).toHaveClass('overflow-x-auto')
    expect((screen.getByRole('table') as HTMLElement).style.minWidth).toBe('896px')
  })

  it('has no scroller without minWidth', () => {
    const { container } = render(<Sample />)
    expect(container.querySelector('[data-table-scroll]')).toBeNull()
    expect(screen.getByRole('table')).toHaveClass('w-auto')
  })

  it('compact density', () => {
    render(<Sample density="compact" />)
    expect(screen.getAllByRole('row')[1]).toHaveClass('h-9')
    expect(screen.getAllByRole('row')[1]).not.toHaveClass('h-11')
  })

  it('default density rows are 44 high', () => {
    render(<Sample />)
    expect(screen.getAllByRole('row')[1]).toHaveClass('h-11')
  })

  it('caption is sr-only', () => {
    render(<Sample caption="成绩表" />)
    expect(screen.getByText('成绩表').tagName).toBe('CAPTION')
    expect(screen.getByText('成绩表')).toHaveClass('sr-only')
  })

  it('wrapper uses the panel surface', () => {
    const { container } = render(<Sample />)
    expect(container.firstElementChild).toHaveClass('rounded-lg', 'shadow-surface', 'bg-card')
  })
})
