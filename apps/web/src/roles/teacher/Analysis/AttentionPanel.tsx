import type { Attention } from '@/shared/lib/grades'

function Group({
  title,
  items,
  names,
  onOpen,
}: {
  title: string
  items: { id: string; label: string }[]
  names: Map<string, string>
  onOpen: (enrollmentId: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="flex w-full justify-between gap-3 hover:underline"
                onClick={() => onOpen(it.id)}
              >
                <span>{names.get(it.id) ?? it.id}</span>
                <span className="text-muted-foreground">{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** showFailing:只有一科可见时不显示"两科及以上不及格" */
export function AttentionPanel({
  attention,
  names,
  showFailing,
  onOpen,
}: {
  attention: Attention
  names: Map<string, string>
  showFailing: boolean
  onOpen: (enrollmentId: string) => void
}) {
  return (
    <section
      aria-label="需要关注"
      className="flex flex-col gap-4 rounded-lg border bg-card p-3 text-card-foreground"
    >
      <h2 className="text-base font-semibold">需要关注</h2>
      <Group
        title="进步之星"
        names={names}
        onOpen={onOpen}
        items={attention.risers.map((r) => ({ id: r.id, label: `↑${r.change}` }))}
      />
      <Group
        title="退步 5 名以上"
        names={names}
        onOpen={onOpen}
        items={attention.fallers.map((r) => ({ id: r.id, label: `↓${-r.change}` }))}
      />
      {showFailing && (
        <Group
          title="两科及以上不及格"
          names={names}
          onOpen={onOpen}
          items={attention.failing.map((r) => ({ id: r.id, label: `${r.count} 科` }))}
        />
      )}
    </section>
  )
}
