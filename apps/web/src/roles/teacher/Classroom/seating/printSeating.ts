import type { DeskGrid } from '@/shared/lib/seats'
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
  schoolName: string
  room: string
  today: string
  grid: DeskGrid
  students: DraftStudent[]
}): string {
  const { className, schoolName, room, today, grid, students } = input
  const at = new Map<string, DraftStudent>()
  for (const s of students) {
    if (s.row !== null && s.col !== null) at.set(`${s.row},${s.col}`, s)
  }
  const label = (s: DraftStudent | undefined) =>
    s ? `${escapeHtml(s.name)}<small>${escapeHtml(s.studentNo ?? '')}</small>` : ''
  const cell = (row: number, col: number, cls: string) => {
    const s = at.get(`${row},${col}`)
    return s ? `<td class="${cls}">${label(s)}</td>` : `<td class="${cls} e">空</td>`
  }
  const span = grid.deskSize
  const body: string[] = []
  for (let row = 1; row <= grid.rows; row++) {
    const cells: string[] = []
    for (let col = 1; col <= grid.cols; col++) {
      cells.push(cell(row, col, 'seat'))
      if (col % span === 0 && col < grid.cols) cells.push('<td class="gap"></td>')
    }
    body.push(`<tr>${cells.join('')}</tr>`)
  }
  // 讲台一行:左边从外侧到内侧、讲台、右边从内侧到外侧;没有讲台座位时只有"讲台"
  const podiumSeat = (col: number) => {
    const s = at.get(`0,${col}`)
    return s ? `<span class="ps">${label(s)}</span>` : '<span class="ps e">空</span>'
  }
  const left = Array.from({ length: grid.podiumLeft }, (_, i) => -(grid.podiumLeft - i)).map(podiumSeat)
  const right = Array.from({ length: grid.podiumRight }, (_, i) => i + 1).map(podiumSeat)
  const podiumRow = `<div class="podium-row">${left.join('')}<div class="podium">讲台</div>${right.join('')}</div>`
  const subtitle = escapeHtml([schoolName, room, today].filter(Boolean).join(' · ') + ' · 讲台在上方')
  const title = escapeHtml(className)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title} 座位表</title>
<style>
body { font-family: sans-serif; margin: 24px; }
h1 { text-align: center; font-size: 20px; }
.sub { text-align: center; color: #555; margin: 0 0 12px; font-size: 13px; }
.podium-row { display: flex; justify-content: center; align-items: stretch; gap: 6px; margin: 0 auto 16px; }
.podium { min-width: 160px; padding: 6px 12px; text-align: center; border: 1px solid #333; }
.ps { min-width: 72px; padding: 4px 6px; text-align: center; border: 1px solid #333; }
small { display: block; font-size: 10px; color: #666; }
.e { color: #aaa; }
table { border-collapse: separate; border-spacing: 6px; margin: 0 auto; }
td.seat { min-width: 72px; height: 36px; padding: 0 6px; text-align: center; border: 1px solid #333; }
td.gap { width: 28px; border: none; }
@media print { body { margin: 8mm; } }
</style>
</head>
<body>
<h1>${title} 座位表</h1>
<p class="sub">${subtitle}</p>
${podiumRow}
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
