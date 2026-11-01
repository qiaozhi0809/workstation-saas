import type { DraftStudent } from './draft'

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ENTITIES[ch])

export function seatingPrintHtml(input: {
  className: string
  rows: number
  cols: number
  students: DraftStudent[]
}): string {
  const { className, rows, cols, students } = input
  const nameAt = new Map<string, string>()
  for (const s of students) {
    if (s.row !== null && s.col !== null) nameAt.set(`${s.row},${s.col}`, s.name)
  }
  const body: string[] = []
  for (let row = 1; row <= rows; row++) {
    const cells: string[] = []
    for (let col = 1; col <= cols; col++) {
      cells.push(`<td class="seat">${escapeHtml(nameAt.get(`${row},${col}`) ?? '')}</td>`)
      if (col % 2 === 0 && col < cols) cells.push('<td class="gap"></td>')
    }
    body.push(`<tr>${cells.join('')}</tr>`)
  }
  const title = escapeHtml(className)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title} 座位表</title>
<style>
body { font-family: sans-serif; margin: 24px; }
h1 { text-align: center; font-size: 20px; }
.podium { margin: 0 auto 16px; width: 40%; padding: 6px 0; text-align: center; border: 1px solid #333; }
table { border-collapse: separate; border-spacing: 6px; margin: 0 auto; }
td.seat { min-width: 72px; height: 36px; padding: 0 6px; text-align: center; border: 1px solid #333; }
td.gap { width: 28px; border: none; }
@media print { body { margin: 8mm; } }
</style>
</head>
<body>
<h1>${title} 座位表</h1>
<div class="podium">讲台</div>
<table>
${body.join('\n')}
</table>
</body>
</html>
`
}

export function printSeating(html: string): void {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}
