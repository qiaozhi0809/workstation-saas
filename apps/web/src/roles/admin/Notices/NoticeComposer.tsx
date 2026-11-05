import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import AckSettings from '@/shared/components/notices/AckSettings'
import { ackSpecError, normalizeAck } from '@/shared/components/notices/ackSpec'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AckSpec, Audience, NoticeOptions, NoticePerson, NoticeTarget } from '@/shared/types/admin'
import TargetPicker, { MAX_USERS, type TargetKind } from './TargetPicker'
import { kindsFor } from './targetKinds'

const ackText = (a: AckSpec) =>
  a.kind === 'none' ? '不要回执' : a.kind === 'confirm' ? '已知晓' : `单选(${a.options.length} 项)`

/** 409 RECIPIENT_UNAVAILABLE 的 details.user_ids;不是 409 或 details 无效时返回 null */
function unavailableIds(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== 'RECIPIENT_UNAVAILABLE') return null
  const ids = (err.details as { user_ids?: unknown } | null | undefined)?.user_ids
  return Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === 'string') ? (ids as string[]) : null
}

/** 左侧编写区。options:发送人可选的范围(school_wide=false 为年级组长,没有"全校");onSent:发送成功后回调 */
export default function NoticeComposer({ options, onSent }: { options: NoticeOptions; onSent?(): void }) {
  const qc = useQueryClient()
  const schoolWide = options.school_wide
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [audience, setAudience] = useState<Audience>('teachers')
  const [pickedKind, setKind] = useState<TargetKind>(schoolWide ? 'school' : 'grade')
  const [pickedGrade, setPickedGrade] = useState<string | null>(null)
  const [classId, setClassId] = useState('')
  const [users, setUsers] = useState<NoticePerson[]>([])
  const [ack, setAck] = useState<AckSpec>({ kind: 'none' })
  const [deadline, setDeadline] = useState<string | null>(null)
  const [ackKey, setAckKey] = useState(0)
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
  const [unavailableMessage, setUnavailableMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  // options 刷新后 school_wide 可能变化:当前对象不在合法范围内时校正
  const kind: TargetKind = kindsFor(audience, schoolWide).includes(pickedKind) ? pickedKind : (schoolWide ? 'school' : 'grade')
  const grades = options.grades
  // options 刷新后已选年级 / 班级可能不在范围内:回落到第一个年级,班级视为未选
  const gradeId = (pickedGrade && grades.some((g) => g.id === pickedGrade) ? pickedGrade : grades[0]?.id) ?? ''
  const klass = options.classes.find((c) => c.id === classId && c.grade_id === gradeId)
  const who = audience === 'parents' ? '家长' : '老师'

  let target: NoticeTarget | null = null
  let label = ''
  if (kind === 'school') {
    target = { kind: 'school' }
    label = `全校${who}`
  } else if (kind === 'grade' && gradeId) {
    target = { kind: 'grade', grade_id: gradeId }
    label = `${grades.find((g) => g.id === gradeId)?.name ?? ''}${who}`
  } else if (kind === 'class' && klass) {
    target = { kind: 'class', class_id: klass.id }
    label = `${klass.name}${who}`
  } else if (audience === 'teachers' && kind === 'users' && users.length > 0 && users.length <= MAX_USERS) {
    target = { kind: 'users', user_ids: users.map((u) => u.user_id) }
    label = `指定 ${users.length} 人`
  }
  const canSend = title.trim() !== '' && content.trim() !== '' && target !== null

  const clearUnavailable = () => { setUnavailable(new Set()); setUnavailableMessage('') }
  const changeGrade = (id: string) => { setPickedGrade(id); setClassId('') }
  const changeKind = (k: TargetKind) => { setKind(k); setClassId(''); clearUnavailable() }
  // 家长对象没有"指定的人":切换时把落在 users 上的对象和已选的人重置到合法值
  const changeAudience = (a: Audience) => {
    setAudience(a)
    if (a === 'parents' && !kindsFor('parents', schoolWide).includes(kind)) {
      setKind(schoolWide ? 'school' : 'grade')
      setClassId('')
    }
    if (a === 'parents') { setUsers([]); clearUnavailable() }
  }
  const changeUsers = (next: NoticePerson[]) => {
    setUsers(next)
    const left = [...unavailable].filter((id) => next.some((u) => u.user_id === id))
    setUnavailable(new Set(left))
    // 不可选的人都去掉后,"有 N 位已不能接收通知"的提示一并收起
    if (left.length === 0) setUnavailableMessage('')
  }

  // AckSettings 的校验只显示、不拦截:点发送与确认发送前都要用 ackSpecError 拦一道
  const openConfirm = () => {
    setResult('')
    const err = ackSpecError(ack, deadline)
    setError(err ?? '')
    if (!err) setConfirming(true)
  }

  const send = async () => {
    if (!target || busy) return
    const ackErr = ackSpecError(ack, deadline)
    if (ackErr) { setError(ackErr); return }
    setError('')
    setBusy(true)
    try {
      const res = await adminApi.sendNotice({
        title: title.trim(), content: content.trim(), target, audience, ...normalizeAck(ack, deadline),
      })
      setResult(`已发给 ${res.recipients} 人`)
      setTitle('')
      setContent('')
      setAck({ kind: 'none' })
      setDeadline(null)
      setAckKey((k) => k + 1)
      clearUnavailable()
      setConfirming(false)
      onSent?.()
      void qc.invalidateQueries({ queryKey: ['notices', 'sent'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'today'] })
    } catch (err) {
      const ids = unavailableIds(err)
      if (ids && target.kind === 'users' && ids.some((id) => users.some((u) => u.user_id === id))) {
        // L46:选好的人在发送前被冻结或解绑,在选择器里标出来,允许去掉后重发
        setUnavailable(new Set(ids))
        setUnavailableMessage((err as ApiError).message)
        setConfirming(false)
      } else {
        setError(err instanceof ApiError ? err.message : '发送失败,请重试')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="写通知" className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">写通知</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notice-title">标题</Label>
        <Input id="notice-title" maxLength={50} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notice-content">正文</Label>
        <Textarea id="notice-content" rows={6} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div role="radiogroup" aria-label="对象类型" className="flex gap-4">
        {(['teachers', 'parents'] as const).map((a) => (
          <label key={a} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="notice-audience" checked={audience === a} onChange={() => changeAudience(a)} />
            {a === 'teachers' ? '老师' : '家长'}
          </label>
        ))}
      </div>
      <TargetPicker
        audience={audience} options={options} kind={kind} onKind={changeKind}
        gradeId={gradeId} onGrade={changeGrade} classId={classId} onClass={setClassId}
        users={users} onUsers={changeUsers} unavailable={unavailable} unavailableMessage={unavailableMessage}
      />
      <AckSettings key={ackKey} value={ack} onChange={(v) => { setError(''); setAck(v) }}
        deadline={deadline} onDeadlineChange={(d) => { setError(''); setDeadline(d) }} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p role="status" className="text-sm text-muted-foreground">{result}</p>
          {error && !confirming && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="button" disabled={!canSend} onClick={openConfirm}>
          发送
        </Button>
      </div>
      {confirming && (
        <Modal open onClose={() => setConfirming(false)} title="发送通知">
          <p className="text-sm">{`确认发给 ${label}?`}</p>
          <p className="mt-1 text-sm text-muted-foreground">{`回执:${ackText(ack)}`}</p>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>取消</Button>
            <Button type="button" disabled={busy} onClick={() => void send()}>确认发送</Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
