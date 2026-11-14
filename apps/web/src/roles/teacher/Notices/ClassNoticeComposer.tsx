import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { classNoticesApi } from '@/shared/api/classNotices'
import AckSettings from '@/shared/components/notices/AckSettings'
import { ackSpecError, normalizeAck } from '@/shared/components/notices/ackSpec'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import type { AckSpec, NoticeSent } from '@/shared/types/admin'

/** 班级公告编写区。AckSettings 只在首次渲染取 props,发送成功后由上层换 key 重置 */
const FIELD_ORDER = ['title', 'content'] as const

export default function ClassNoticeComposer({
  classId,
  className,
  onSent,
}: {
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
  const { errors, report, clear, fieldRef } = useFormErrors(FIELD_ORDER)

  const send = useMutation({
    mutationFn: () => {
      const { ack: a, ack_deadline } = normalizeAck(ack, deadline)
      return classNoticesApi.send(classId, {
        title: title.trim(),
        content: content.trim(),
        ack: a,
        ack_deadline,
      })
    },
    onSuccess: (res) => {
      toast(`已发给 ${res.recipients} 位家长`)
      if (res.students_without_parent > 0)
        toast(`另有 ${res.students_without_parent} 名学生还没有绑定家长,他们收不到`)
      void qc.invalidateQueries({ queryKey: ['class-notices', classId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '发送失败,请重试'),
  })

  const submit = () => {
    if (send.isPending) return
    // 空标题 / 空正文:就地报错并聚焦第一个出错的字段,不禁用发送按钮
    const missing: { title?: string; content?: string } = {}
    if (title.trim() === '') missing.title = '请填写标题'
    if (content.trim() === '') missing.content = '请填写正文'
    if (!report(missing)) return
    const bad = ackSpecError(ack, deadline)
    if (bad) {
      setError(bad)
      return
    }
    setError('')
    // 回调挂在 mutate 上:换班卸载后不会清掉新班的草稿
    send.mutate(undefined, { onSuccess: onSent })
  }

  return (
    <Card className="p-4">
      <section aria-label="写公告" className="flex flex-col gap-4">
        <h2 className="text-base font-medium">写公告</h2>
        <p className="text-sm text-muted-foreground">{`${className}全体家长`}</p>
        <Field label="标题" error={errors.title}>
          <Input
            ref={fieldRef('title')}
            maxLength={50}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              clear('title')
            }}
          />
        </Field>
        <Field label="正文" error={errors.content}>
          <Textarea
            ref={fieldRef('content')}
            rows={6}
            maxLength={2000}
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              clear('content')
            }}
          />
        </Field>
        <AckSettings
          value={ack}
          onChange={setAck}
          deadline={deadline}
          onDeadlineChange={setDeadline}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" disabled={send.isPending} onClick={submit}>
            发送
          </Button>
        </div>
      </section>
    </Card>
  )
}
