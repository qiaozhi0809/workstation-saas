import { parseTable } from './table'

describe('parseTable', () => {
  it('splits on Tab when the first non-empty line has one', () => {
    expect(parseTable('姓名\t学号\n张三\t01')).toEqual([
      ['姓名', '学号'],
      ['张三', '01'],
    ])
  })
  it('splits on comma otherwise', () => {
    expect(parseTable('姓名,学号\n张三,01')).toEqual([
      ['姓名', '学号'],
      ['张三', '01'],
    ])
  })
  it('detects the delimiter on the first non-empty line, skipping leading blanks', () => {
    expect(parseTable('\n\na\tb,c\nx,y')).toEqual([['a', 'b,c'], ['x,y']])
  })
  it('keeps empty cells and blank rows when keepEmpty', () => {
    expect(parseTable('90\t\t80\n\n70\t60\t', true)).toEqual([
      ['90', '', '80'],
      [''],
      ['70', '60', ''],
    ])
  })
  it('drops blank rows when keepEmpty is false', () => {
    expect(parseTable('a,b\n\n,\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseTable('a,b\n\n,\nc,d', false)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
  it('parses quoted CSV with commas and newlines', () => {
    expect(parseTable('姓名,备注\n张三,"说,""好""\n下一行"')).toEqual([
      ['姓名', '备注'],
      ['张三', '说,"好"\n下一行'],
    ])
  })
  it('handles CRLF line endings', () => {
    expect(parseTable('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
  it('always drops a single trailing blank line, even with keepEmpty', () => {
    expect(parseTable('a\tb\n', true)).toEqual([['a', 'b']])
    expect(parseTable('a\tb\n\n', true)).toEqual([['a', 'b'], ['']])
  })
  it('trims whitespace around cells', () => {
    expect(parseTable(' a , b ')).toEqual([['a', 'b']])
  })
  it('returns [] for empty input', () => {
    expect(parseTable('')).toEqual([])
    expect(parseTable('\n\n')).toEqual([])
  })
})
