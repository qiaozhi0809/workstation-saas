const show = (v: unknown): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 展开行:extra 的键值对 */
export default function AuditRowDetail({ extra }: { extra: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {Object.entries(extra).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{show(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
