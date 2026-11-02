export default function Field({ label, value }: { label: string; value?: string }) {
  const text = value?.trim()
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{text ? text : <span className="text-muted-foreground">暂无</span>}</dd>
    </div>
  )
}
