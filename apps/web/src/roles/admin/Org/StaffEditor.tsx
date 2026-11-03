import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import type { Account, ClassAdmin, StaffBrief, StaffInput } from '@/shared/types/admin'
import ConfirmBox from './ConfirmBox'
import { errMsg } from './errMsg'
import Field from './Field'
import PersonPicker from './PersonPicker'

type Identity = StaffInput['identity']
const TITLE: Record<Identity, string> = { homeroom: '班主任', assistant: '副班主任', subject: '任课老师' }

function Person({ s, label, onEnd }: { s: StaffBrief; label: string; onEnd(): void }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span>{s.display_name}</span>
      <Button variant="ghost" size="sm" aria-label={`卸任 ${s.display_name}${label}`} onClick={onEnd}>卸任</Button>
    </li>
  )
}

export default function StaffEditor({ cls }: { cls: ClassAdmin }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState<Identity | null>(null)
  const [picked, setPicked] = useState<Account | null>(null)
  const [subject, setSubject] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [ending, setEnding] = useState<StaffBrief | null>(null)
  const [error, setError] = useState<string | null>(null)

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'class', cls.id] })
    void qc.invalidateQueries({ queryKey: ['admin', 'classes'] })
  }
  const close = () => { setAdding(null); setPicked(null); setSubject(''); setConfirmReplace(false); setEnding(null); setError(null) }
  const add = useMutation({
    mutationFn: (b: StaffInput) => adminApi.addStaff(cls.id, b),
    onSuccess: () => { toast('已添加'); done(); close() },
    onError: (e) => setError(errMsg(e)),
  })
  const end = useMutation({
    mutationFn: (id: string) => adminApi.endStaff(id),
    onSuccess: () => { toast('已卸任'); done(); close() },
    onError: (e) => setError(errMsg(e)),
  })

  const submit = () => {
    if (!adding || !picked) return
    if (adding === 'homeroom' && cls.homeroom && !confirmReplace) { setConfirmReplace(true); return }
    add.mutate({ user_id: picked.id, identity: adding, subject: adding === 'subject' ? subject.trim() : null })
  }
  const ready = !!picked && (adding !== 'subject' || subject.trim() !== '')
  const open = (i: Identity) => { setError(null); setAdding(i) }

  return (
    <Card>
      <CardHeader><CardTitle>任课与班主任</CardTitle></CardHeader>
      <CardContent className="grid gap-5">
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">班主任</h3>
          <ul className="grid gap-1">
            {cls.homeroom ? <Person s={cls.homeroom} label="(班主任)" onEnd={() => { setError(null); setEnding(cls.homeroom) }} />
              : <li className="text-sm text-muted-foreground">暂无班主任</li>}
          </ul>
          <div><Button variant="outline" size="sm" onClick={() => open('homeroom')}>{cls.homeroom ? '更换班主任' : '添加班主任'}</Button></div>
        </section>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">副班主任</h3>
          <ul className="grid gap-1">
            {cls.assistants.map((s) => <Person key={s.assignment_id} s={s} label="(副班主任)" onEnd={() => { setError(null); setEnding(s) }} />)}
            {cls.assistants.length === 0 && <li className="text-sm text-muted-foreground">暂无副班主任</li>}
          </ul>
          <div><Button variant="outline" size="sm" onClick={() => open('assistant')}>添加副班主任</Button></div>
        </section>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">任课老师</h3>
          {cls.subjects.map((g) => (
            <div key={g.subject} className="flex flex-wrap items-center gap-x-4 text-sm">
              <span className="w-12 text-muted-foreground">{g.subject}</span>
              <ul className="flex flex-wrap gap-x-3">
                {g.teachers.map((s) => <Person key={s.assignment_id} s={s} label={`(${g.subject})`} onEnd={() => { setError(null); setEnding(s) }} />)}
              </ul>
            </div>
          ))}
          {cls.subjects.length === 0 && <p className="text-sm text-muted-foreground">暂无任课老师</p>}
          <div><Button variant="outline" size="sm" onClick={() => open('subject')}>添加任课老师</Button></div>
        </section>
      </CardContent>

      <Modal open={adding !== null && !confirmReplace} onClose={close} dismissOnOutside={false} title={adding ? (adding === 'homeroom' && cls.homeroom ? '更换班主任' : `添加${TITLE[adding]}`) : ''} className="max-w-md">
        <div className="grid gap-3">
          <PersonPicker value={picked} onChange={setPicked} />
          {adding === 'subject' && (
            <>
              <Field label="科目">
                <Input list="staff-subjects" value={subject} maxLength={10} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <datalist id="staff-subjects">
                {(picked?.subjects ?? []).map((s) => <option key={s} value={s} />)}
              </datalist>
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>取消</Button>
            <Button disabled={!ready || add.isPending} onClick={submit}>添加</Button>
          </div>
        </div>
      </Modal>

      <ConfirmBox open={confirmReplace} title="更换班主任" confirmLabel="确认更换" error={error} busy={add.isPending}
        onConfirm={submit} onClose={close}>
        <p>{`原班主任 ${cls.homeroom?.display_name ?? ''} 将卸任,新班主任为 ${picked?.display_name ?? ''}。`}</p>
      </ConfirmBox>

      <ConfirmBox open={ending !== null} title="确认卸任" confirmLabel="确认卸任" error={error} busy={end.isPending}
        onConfirm={() => ending && end.mutate(ending.assignment_id)} onClose={close}>
        <p>{`${ending?.display_name ?? ''} 将卸任,不再负责本班。`}</p>
      </ConfirmBox>
    </Card>
  )
}
