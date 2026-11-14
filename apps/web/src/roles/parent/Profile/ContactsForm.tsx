import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import type { Contact } from '@/shared/types/student'

const blank = (): Contact => ({ name: '', relation: '', phone: '', job: '' })
// 错误按行报,挂在该行的姓名框上;焦点顺序 = 行顺序
const ORDER = ['row0', 'row1'] as const

export default function ContactsForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Contact[]
  onSave(contacts: Contact[]): Promise<void>
  onCancel(): void
}) {
  const [rows, setRows] = useState<Contact[]>(() => [...initial, blank(), blank()].slice(0, 2))
  // 服务端保存失败这类整表单错误不属于某个字段,单独显示
  const [error, setError] = useState<string | null>(null)
  const { errors, report, clear, fieldRef } = useFormErrors(ORDER)
  const [busy, setBusy] = useState(false)
  const touch = (i: number, patch: Partial<Contact>) => {
    setRows((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    clear(ORDER[i])
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = rows.map((c) => ({
      name: c.name.trim(),
      relation: c.relation.trim(),
      phone: c.phone.trim(),
      job: c.job.trim(),
    }))
    const next: Partial<Record<(typeof ORDER)[number], string>> = {}
    trimmed.forEach((c, i) => {
      if ((c.name || c.relation || c.phone || c.job) && !c.name && !c.phone)
        next[ORDER[i]] = '联系人姓名和电话至少填一项'
    })
    if (!report(next)) return
    const contacts = trimmed.filter((c) => c.name || c.relation || c.phone || c.job)
    setError(null)
    setBusy(true)
    try {
      await onSave(contacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const field = 'h-11 text-base md:text-sm'
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {rows.map((c, i) => (
        <div key={i} className="grid grid-cols-2 gap-x-2 gap-y-3 rounded-md bg-muted p-3">
          <Field label="姓名" error={errors[ORDER[i]]}>
            <Input
              ref={fieldRef(ORDER[i])}
              className={field}
              aria-label={`联系人${i + 1}姓名`}
              maxLength={20}
              value={c.name}
              onChange={(e) => touch(i, { name: e.target.value })}
            />
          </Field>
          <Field label="关系">
            <Input
              className={field}
              aria-label={`联系人${i + 1}关系`}
              maxLength={10}
              value={c.relation}
              onChange={(e) => touch(i, { relation: e.target.value })}
            />
          </Field>
          <Field label="电话">
            <Input
              className={field}
              aria-label={`联系人${i + 1}电话`}
              inputMode="tel"
              maxLength={20}
              value={c.phone}
              onChange={(e) => touch(i, { phone: e.target.value })}
            />
          </Field>
          <Field label="职业">
            <Input
              className={field}
              aria-label={`联系人${i + 1}职业`}
              maxLength={20}
              value={c.job}
              onChange={(e) => touch(i, { job: e.target.value })}
            />
          </Field>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="touch" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="touch" disabled={busy}>
          保存
        </Button>
      </div>
    </form>
  )
}
