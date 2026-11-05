import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { classNoticesApi } from '@/shared/api/classNotices'
import AckSettings from '@/shared/components/notices/AckSettings'
import { ackSpecError, normalizeAck } from '@/shared/components/notices/ackSpec'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AckSpec, NoticeSent } from '@/shared/types/admin'

/** 班级公告编写区。AckSettings 只在首次渲染取 props,发送成功后由上层换 key 重置 */
export default function ClassNoticeComposer({ classId, className, onSent }: {
  classId: string
  className: string
  onSent(res: NoticeSent): void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [ack, setAck] = useState<AckSpec>({ kind: 'none' })
  const [deadline, setDeadline] = useState<string | null>(null)
  const [error, setError] = useState('')

  const send = useMutation({
    mutationFn: () => {
      const { ack: a, ack_deadline } = normalizeAck(ack, deadline)
      return classNoticesApi.send(classId, { title: title.trim(), content: content.trim(), ack: a, ack_deadline })
    },
    onSuccess: (res) => {
      toast(`已发给 ${res.recipients} 位家长`)
      if (res.students_without_parent > 0) toast(`另有 ${res.students_without_parent} 名学生还没有绑定家长,他们收不到`)
      void qc.invalidateQueries({ queryKey: ['class-notices', classId] })
      onSent(res)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '发送失败,请重试'),
  })

  const submit = () => {
    if (send.isPending) return
    const bad = ackSpecError(ack, deadline)
    if (bad) { setError(bad); return }
    setError('')
    send.mutate()
  }

  const canSend = title.trim() !== '' && content.trim() !== ''

  return (
    <section aria-label="写公告" className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">写公告</h2>
      <p className="text-sm text-muted-foreground">{`${className}全体家长`}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="class-notice-title">标题</Label>
        <Input id="class-notice-title" maxLength={50} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="class-notice-content">正文</Label>
        <Textarea id="class-notice-content" rows={6} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <AckSettings value={ack} onChange={setAck} deadline={deadline} onDeadlineChange={setDeadline} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <Button type="button" disabled={!canSend || send.isPending} onClick={submit}>发送</Button>
      </div>
    </section>
  )
}
