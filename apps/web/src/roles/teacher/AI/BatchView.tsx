import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { commentsApi } from '@/shared/api/comments'
import { Markdown } from '@/shared/components/Markdown'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import type { AiBatchItem, AiChat, AiItemStatus, AiPrompt } from '@/shared/types/ai'
import type { ClassPerm } from '@/shared/types/classroom'
import CopyPromptDialog from './CopyPromptDialog'
import { useBatchRunner } from './useBatchRunner'

const NOT_CONFIGURED = '学校还没有配置 AI 服务,请联系管理员;可以先复制提示词'

const STATUS: Record<AiItemStatus, { label: string; variant: 'neutral' | 'info' | 'danger' | 'success' }> = {
  wait: { label: '排队中', variant: 'neutral' },
  run: { label: '生成中', variant: 'info' },
  err: { label: '失败', variant: 'danger' },
  done: { label: '完成', variant: 'success' },
}

interface Props {
  chat: AiChat
  classId: string
  perms: ClassPerm[]
}

/** 批量对话的主体:进度条 + 开始 / 继续 / 停止 + 全部保存 + 每个学生一张卡片。 */
export default function BatchView({ chat, classId, perms }: Props) {
  const qc = useQueryClient()
  const { running, currentId, liveText, notConfigured, start, stop } = useBatchRunner(chat)
  const [prompt, setPrompt] = useState<AiPrompt | null>(null)
  const items = chat.items
  const done = items.filter((i) => i.status === 'done')
  const pending = items.some((i) => i.status === 'wait' || i.status === 'err')
  const canSave = chat.save_as === 'comment' && perms.includes('comment.write')
  // 本页已保存过的条目:再点「全部保存」时不重复写入(只在本次打开期间有效)
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const markSaved = (ids: string[]) => setSaved((s) => new Set([...s, ...ids]))
  const unsaved = done.filter((i) => !saved.has(i.id))

  const saveAll = useMutation({
    mutationFn: (batch: AiBatchItem[]) => commentsApi.bulk(classId, {
      items: batch.map((i) => ({ student_id: i.student_id, content: i.content })),
      generated_by_ai: true,
    }),
    onSuccess: (r, batch) => {
      toast(`已保存 ${r.created} 条评语`)
      markSaved(batch.map((i) => i.id))
      for (const i of batch) void qc.invalidateQueries({ queryKey: ['comments', i.student_id] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '保存失败,请重试'),
  })

  const openPrompt = () => {
    aiApi.chatPrompt(chat.id).then(setPrompt, () => toast('获取提示词失败,请重试'))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="progressbar"
          aria-label={`完成 ${done.length}/${items.length}`}
          aria-valuemin={0}
          aria-valuenow={done.length}
          aria-valuemax={items.length}
          className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: items.length ? `${(done.length / items.length) * 100}%` : '0%' }}
          />
        </div>
        <span className="text-sm text-muted-foreground">完成 {done.length}/{items.length}</span>
        {running ? (
          <Button size="sm" variant="outline" onClick={stop}>停止</Button>
        ) : pending ? (
          <Button size="sm" onClick={start}>{done.length > 0 || items.some((i) => i.status === 'err') ? '继续生成' : '开始生成'}</Button>
        ) : null}
        {canSave && unsaved.length > 0 && (
          <Button size="sm" variant="outline" disabled={saveAll.isPending} onClick={() => saveAll.mutate(unsaved)}>
            {saved.size === 0 ? '全部保存到档案' : `保存其余 ${unsaved.length} 条`}
          </Button>
        )}
      </div>

      {notConfigured && !running && (
        <div className="space-y-2 rounded-lg border border-destructive p-3">
          <p className="text-sm text-destructive">{NOT_CONFIGURED}</p>
          <Button size="sm" variant="outline" onClick={openPrompt}>复制提示词</Button>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            live={item.id === currentId}
            liveText={liveText}
            canSave={canSave}
            saved={saved.has(item.id)}
            onSaved={() => markSaved([item.id])}
          />
        ))}
      </ul>
      {prompt && <CopyPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}

function ItemCard({ item, live, liveText, canSave, saved, onSaved }: {
  item: AiBatchItem
  live: boolean
  liveText: string
  canSave: boolean
  saved: boolean
  onSaved(): void
}) {
  const qc = useQueryClient()
  const status: AiItemStatus = live ? 'run' : item.status
  const text = live ? liveText : item.content
  const save = useMutation({
    mutationFn: () => commentsApi.create(item.student_id, { content: item.content, generated_by_ai: true }),
    onSuccess: () => {
      toast('已保存到档案的评语')
      onSaved()
      void qc.invalidateQueries({ queryKey: ['comments', item.student_id] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '保存失败,请重试'),
  })
  const { label, variant } = STATUS[status]
  return (
    <li className="space-y-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.student_name}</span>
        {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
        <Badge variant={variant}>{label}</Badge>
      </div>
      {status === 'err' && item.error && <p className="text-sm text-destructive">{item.error}</p>}
      {text !== '' && <Markdown text={text} />}
      {status === 'done' && !live && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => {
            void navigator.clipboard.writeText(item.content).then(
              () => toast('已复制'),
              () => toast('复制失败,请手动选中文字复制'),
            )
          }}>复制</Button>
          {canSave && (
            <Button size="sm" variant="ghost" disabled={save.isPending || saved} onClick={() => save.mutate()}>
              {saved ? '已保存' : '保存到档案'}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
