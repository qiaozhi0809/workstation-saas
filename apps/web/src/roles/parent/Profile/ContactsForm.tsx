import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import type { Contact } from '@/shared/types/student'

const blank = (): Contact => ({ name: '', relation: '', phone: '', job: '' })

export default function ContactsForm({ initial, onSave, onCancel }: {
  initial: Contact[]; onSave(contacts: Contact[]): Promise<void>; onCancel(): void
}) {
  const [rows, setRows] = useState<Contact[]>(() => [...initial, blank(), blank()].slice(0, 2))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<Contact>) => setRows((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const contacts = rows
      .map((c) => ({ name: c.name.trim(), relation: c.relation.trim(), phone: c.phone.trim(), job: c.job.trim() }))
      .filter((c) => c.name || c.relation || c.phone || c.job)
    if (contacts.some((c) => !c.name && !c.phone)) { setError('联系人姓名和电话至少填一项'); return }
    setError(null)
    setBusy(true)
    try { await onSave(contacts) } catch (err) { setError(err instanceof Error ? err.message : '保存失败') } finally { setBusy(false) }
  }

  const field = 'h-11 text-base md:text-sm'
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {rows.map((c, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2">
          <Input className={field} aria-label={`联系人${i + 1}姓名`} placeholder="姓名" maxLength={20} value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
          <Input className={field} aria-label={`联系人${i + 1}关系`} placeholder="关系" maxLength={10} value={c.relation} onChange={(e) => set(i, { relation: e.target.value })} />
          <Input className={field} aria-label={`联系人${i + 1}电话`} placeholder="电话" inputMode="tel" maxLength={20} value={c.phone} onChange={(e) => set(i, { phone: e.target.value })} />
          <Input className={field} aria-label={`联系人${i + 1}职业`} placeholder="职业" maxLength={20} value={c.job} onChange={(e) => set(i, { job: e.target.value })} />
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 min-w-[44px]" onClick={onCancel}>取消</Button>
        <Button type="submit" className="h-11 min-w-[44px]" disabled={busy}>保存</Button>
      </div>
    </form>
  )
}
