import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { commentsApi } from '@/shared/api/comments'
import { ApiError } from '@/shared/api/client'
import { growthApi } from '@/shared/api/growth'
import { Markdown } from '@/shared/components/Markdown'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { exportWord } from '@/shared/lib/exportWord'
import type { AiChat, AiMessage } from '@/shared/types/ai'
import type { ClassPerm } from '@/shared/types/classroom'
import { stripMarkdown } from './stripMarkdown'

/** 助手消息的错误框:红框 + 错误文字 + 重试 / 改为复制提示词。 */
export function ErrorBox({ message, onRetry, onCopyPrompt }: {
  message: string
  /** 不传 = 不显示重试(只有最后一条消息可以重试) */
  onRetry?(): void
  onCopyPrompt(): void
}) {
  return (
    <div data-testid="error-box" className="space-y-2 rounded-lg border border-destructive p-3">
      <p className="text-sm text-destructive">{message}</p>
      <div className="flex gap-2">
        {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>}
        <Button size="sm" variant="outline" onClick={onCopyPrompt}>改为复制提示词</Button>
      </div>
    </div>
  )
}

/** 助手消息的头部图标。 */
export function AssistantIcon() {
  return (
    <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  )
}

interface Props {
  chat: AiChat
  message: AiMessage
  perms: ClassPerm[]
  today: string
  /** 是否可显示"重新生成"(最后一条、非批量、没有正在生成) */
  canRegenerate: boolean
  onRegenerate(): void
  onRetry?(): void
  onCopyPrompt(): void
}

export default function MessageItem({ chat, message, perms, today, canRegenerate, onRegenerate, onRetry, onCopyPrompt }: Props) {
  const qc = useQueryClient()
  const studentId = chat.student_id
  const saveComment = useMutation({
    mutationFn: () => commentsApi.create(studentId as string, { content: message.content, generated_by_ai: true }),
    onSuccess: () => {
      toast('已保存到档案的评语')
      void qc.invalidateQueries({ queryKey: ['comments', studentId] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '保存失败,请重试'),
  })
  const saveGrowth = useMutation({
    mutationFn: () => growthApi.create(studentId as string, {
      type: '其他', date: today, content: stripMarkdown(message.content).slice(0, 200),
    }),
    onSuccess: () => {
      toast('已记到成长记录')
      void qc.invalidateQueries({ queryKey: ['growth', studentId] })
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : '保存失败,请重试'),
  })

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    )
  }

  if (message.status === 'error') {
    return (
      <div className="flex gap-2">
        <AssistantIcon />
        <div className="min-w-0 flex-1">
          <ErrorBox message={message.error ?? '生成失败了'} onRetry={onRetry} onCopyPrompt={onCopyPrompt} />
        </div>
      </div>
    )
  }

  const finished = message.status === 'done' || message.status === 'stopped'
  const canComment = chat.save_as === 'comment' && !!studentId && perms.includes('comment.write')
  const canGrowth = !!studentId && perms.includes('growth.write')
  return (
    <div className="flex gap-2">
      <AssistantIcon />
      <div className="min-w-0 flex-1">
        <Markdown text={message.content} />
        {message.status === 'stopped' && <p className="text-xs text-muted-foreground">(已停止)</p>}
        {finished && (
          <div className="mt-1 flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" onClick={() => {
              void navigator.clipboard.writeText(message.content).then(
                () => toast('已复制'),
                () => toast('复制失败,请手动选中文字复制'),
              )
            }}>复制</Button>
            <Button size="sm" variant="ghost" aria-label="导出该条 Word" onClick={() => exportWord(chat.title, message.content)}>
              导出 Word
            </Button>
            {canComment && (
              <Button size="sm" variant="ghost" disabled={saveComment.isPending || saveComment.isSuccess} onClick={() => saveComment.mutate()}>
                {saveComment.isSuccess ? '已保存' : '保存为评语'}
              </Button>
            )}
            {canGrowth && (
              <Button size="sm" variant="ghost" disabled={saveGrowth.isPending || saveGrowth.isSuccess} onClick={() => saveGrowth.mutate()}>
                {saveGrowth.isSuccess ? '已记录' : '记到成长记录'}
              </Button>
            )}
            {canRegenerate && (
              <Button size="sm" variant="ghost" onClick={onRegenerate}>重新生成</Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
