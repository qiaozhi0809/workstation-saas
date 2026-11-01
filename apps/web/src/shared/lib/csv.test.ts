import { toCSV } from './csv'

it('writes BOM, CRLF and quotes special cells', () => {
  expect(toCSV([['a', 'b,c'], ['say "hi"', null]])).toBe('﻿a,"b,c"\r\n"say ""hi""",')
})

it('neutralises formula-looking text but keeps numbers', () => {
  expect(toCSV([['=SUM(A1)', '+1', '@x', '-2', -1, 3]])).toBe("﻿'=SUM(A1),'+1,'@x,'-2,-1,3")
})
