type Cell = string | number | null | undefined

function encodeCell(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  let text = String(cell)
  if (typeof cell === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCSV(rows: Cell[][]): string {
  return '﻿' + rows.map((row) => row.map(encodeCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
