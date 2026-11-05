import type { LayoutDraft, LayoutPreview } from '@/shared/types/seating'

function Block({ name }: { name?: string }) {
  return (
    <span
      title={name}
      className={name ? 'size-4 rounded-sm bg-foreground' : 'size-4 rounded-sm bg-muted'}
    />
  )
}

export function SeatPreview(p: {
  draft: LayoutDraft
  preview: LayoutPreview
  names: Record<string, string>
}) {
  const { draft, preview, names } = p
  const at = new Map(preview.seats.map((s) => [`${s.row},${s.col}`, names[s.enrollment_id] ?? '']))
  const seat = (row: number, col: number) => {
    const has = at.has(`${row},${col}`)
    return (
      <Block key={`${row},${col}`} name={has ? at.get(`${row},${col}`) || '已排座' : undefined} />
    )
  }
  // 单人单列也两张一组画,和教室图的分组一致
  const span = draft.desk_size === 1 ? 2 : draft.desk_size
  const left = Array.from({ length: draft.podium_left }, (_, i) => -(draft.podium_left - i))
  const right = Array.from({ length: draft.podium_right }, (_, i) => i + 1)
  const groups = Array.from({ length: Math.ceil(preview.cols / span) }, (_, g) =>
    Array.from({ length: Math.min(span, preview.cols - g * span) }, (_, i) => g * span + i + 1),
  )
  return (
    <div className="space-y-2" aria-label="座位预览">
      <div className="flex items-center justify-center gap-1">
        {left.map((c) => seat(0, c))}
        <span className="rounded-sm bg-muted px-3 py-0.5 text-xs text-muted-foreground">讲台</span>
        {right.map((c) => seat(0, c))}
      </div>
      <div className="space-y-1">
        {Array.from({ length: preview.rows }, (_, r) => (
          <div key={r} className="flex justify-center gap-3">
            {groups.map((cols) => (
              <div key={cols[0]} className="flex gap-0.5">
                {cols.map((c) => seat(r + 1, c))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
