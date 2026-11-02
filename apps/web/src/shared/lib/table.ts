/** Parses pasted Excel (Tab) or CSV (comma) text into a string grid. */
export function parseTable(text: string, keepEmpty = false): string[][] {
  const firstLine = text.split('\n').find(l => l.replace(/\r/g, '').trim() !== '') ?? ''
  const delim = firstLine.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endCell = () => { row.push(cell.trim()); cell = '' }
  const endRow = () => { endCell(); rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delim) endCell()
    else if (c === '\n') endRow()
    else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length > 0) endRow()
  const isBlank = (r: string[]) => r.every(x => x === '')
  // The segment after a final line break is never emitted, so the blank row
  // that copying leaves at the end is always dropped.
  return keepEmpty ? rows : rows.filter(r => !isBlank(r))
}
