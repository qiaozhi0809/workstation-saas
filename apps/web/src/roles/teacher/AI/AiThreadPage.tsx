import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { Markdown } from '@/shared/components/Markdown'
import { toast } from '@/shared/components/Toast'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { exportWord } from '@/shared/lib/exportWord'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { AiChat, AiPrompt } from '@/shared/types/ai'
import ClassGate, { type ClassContext } from '../ClassGate'
import CopyPromptDialog from './CopyPromptDialog'
import MessageItem, { AssistantIcon, ErrorBox } from './MessageItem'
import StatusPill from './StatusPill'
import ThreadComposer from './ThreadComposer'
import { useAiStream } from './useAiStream'
import { classesApi } from '@/shared/api/classes'

const NEAR_BOTTOM_PX = 180
const NOT_CONFIGURED = '学校还没有配置 AI 服务,请联系管理员;可以先复制提示词'

/** AI 助手对话页 /teacher/ai/:chatId:需要本班 ai.use 权限。 */
export default function AiThreadPage() {
  return (
    <ClassGate title="AI 助手" need="ai.use">
      {(ctx) => <ThreadBody ctx={ctx} />}
    </ClassGate>
  )
}

function NotFound() {
  return (
    <EmptyState
      title="找不到这个对话"
      action={<Link to="/teacher/ai" className="text-sm text-primary underline">← 返回 AI 助手</Link>}
    />
  )
}

function ThreadBody({ ctx }: { ctx: ClassContext }) {
  const { chatId = '' } = useParams()
  const chatQ = useQuery({ queryKey: ['ai-chat', chatId], queryFn: () => aiApi.getChat(chatId) })
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })

  if (chatQ.isLoading) return <LoadingState />
  if (chatQ.isError && !chatQ.data) {
    if (chatQ.error instanceof ApiError && chatQ.error.code === 'NOT_FOUND') return <NotFound />
    return <ErrorState title="对话加载失败" onRetry={() => void chatQ.refetch()} retrying={chatQ.isFetching} />
  }
  const chat = chatQ.data
  if (!chat) return <LoadingState />
  if (chat.class_id !== ctx.cls.id) {
    const other = classes.data?.items.find((c) => c.id === chat.class_id)
    if (!other) return <NotFound />
    return (
      <EmptyState
        title="这个对话属于其他班级"
        action={<Button onClick={() => useTeacherStore.getState().setClass(chat.class_id)}>切换到{other.name}</Button>}
      />
    )
  }
  return <Thread ctx={ctx} chat={chat} chatId={chatId} />
}

function Thread({ ctx, chat, chatId }: { ctx: ClassContext; chat: AiChat; chatId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status })
  const { streaming, text, error, start, stop } = useAiStream(chatId, ctx.cls.id)
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<AiPrompt | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const goHandled = useRef(false)

  const live = streaming || text !== ''
  const all = chat.messages
  const last = all[all.length - 1]
  // 生成中,最后一条助手回复(重新生成时)由流式气泡代替
  const shown = live && last?.role === 'assistant' ? all.slice(0, -1) : all

  // ?go=1:最后一条是还没回复的用户消息时自动开始,只一次
  useEffect(() => {
    if (goHandled.current) return
    if (new URLSearchParams(location.search).get('go') !== '1') return
    goHandled.current = true
    if (!chat.batch_only && last?.role === 'user') start({})
    navigate({ pathname: location.pathname }, { replace: true })
  }, [chat.batch_only, last?.role, location.pathname, location.search, navigate, start])

  useEffect(() => { if (!live) setPendingUser(null) }, [live])

  // 内容变化时,离底部不到 180px 才跟随滚动
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) el.scrollTop = el.scrollHeight
  }, [all.length, text, error, pendingUser])

  const remove = useMutation({
    mutationFn: () => aiApi.deleteChat(chatId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-chats', ctx.cls.id] })
      navigate('/teacher/ai')
    },
    onError: () => toast('删除失败,请重试'),
  })

  const openPrompt = () => {
    aiApi.chatPrompt(chatId).then(setPrompt, () => toast('获取提示词失败,请重试'))
  }
  const send = (t: string) => { setPendingUser(t); start({ text: t }) }
  const retry = () => start({ regenerate: true })

  const exportAll = () => {
    const md = all.map((m) => (m.role === 'user' ? `**老师:**${m.content}` : m.content)).join('\n\n---\n\n')
    exportWord(chat.title, md)
  }

  const lastIsErrorMsg = last?.role === 'assistant' && last.status === 'error'
  const showHookError = error && !live && !lastIsErrorMsg

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Link to="/teacher/ai" className="text-sm text-muted-foreground hover:text-foreground">← 新对话</Link>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{chat.title}</h2>
        <StatusPill status={status.data} />
        <Button size="sm" variant="outline" onClick={exportAll}>导出 Word</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={remove.isPending}
          onClick={() => { if (window.confirm('删除这个对话?')) remove.mutate() }}
        >
          删除
        </Button>
      </header>

      <div ref={scrollRef} data-testid="thread-scroll" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {/* 批量对话(Task 20)在这里用批量视图替换消息列表 */}
        {shown.map((m, i) => (
          <MessageItem
            key={m.id}
            chat={chat}
            message={m}
            perms={ctx.perms}
            today={ctx.summary.today}
            canRegenerate={!chat.batch_only && !live && i === shown.length - 1}
            onRegenerate={retry}
            onRetry={retry}
            onCopyPrompt={openPrompt}
          />
        ))}
        {pendingUser !== null && live && (
          <div className="flex justify-end">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">{pendingUser}</div>
          </div>
        )}
        {live && (
          <div className="flex gap-2">
            <AssistantIcon />
            <div className="min-w-0 flex-1">
              {streaming && <p className="text-xs text-muted-foreground">班级助理 · 正在写…</p>}
              <div data-testid="stream-text">
                <Markdown text={text} />
              </div>
              {streaming && (
                <span data-testid="stream-cursor" aria-hidden="true" className="inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
              )}
            </div>
          </div>
        )}
        {showHookError && (
          error.code === 'AI_NOT_CONFIGURED' ? (
            <div className="space-y-2 rounded-lg border border-destructive p-3">
              <p className="text-sm text-destructive">{NOT_CONFIGURED}</p>
              <Button size="sm" variant="outline" onClick={openPrompt}>复制提示词</Button>
            </div>
          ) : (
            <ErrorBox message={error.message} onRetry={retry} onCopyPrompt={openPrompt} />
          )
        )}
      </div>

      {!chat.batch_only && <ThreadComposer streaming={streaming} onSend={send} onStop={stop} />}
      {prompt && <CopyPromptDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </div>
  )
}
