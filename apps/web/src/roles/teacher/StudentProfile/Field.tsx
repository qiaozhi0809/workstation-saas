export default function Field({ label, value }: { label: string; value?: string }) {
  const text = value?.trim()
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-ink-2">{label}</dt>
      <dd>{text ? text : <span className="text-ink-3">暂无</span>}</dd>
    </div>
  )
}
