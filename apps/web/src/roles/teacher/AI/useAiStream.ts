import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import type { AiReplyInput } from '@/shared/types/ai'

export interface AiStreamError {
  code: string
  message: string
}

const FLUSH_MS = 100
const ABORT_REFETCH_MS = 500
const BROKEN: AiStreamError = { code: 'AI_STREAM_BROKEN', message: '连接中断了,可以点「重试」' }

/**
 * 对话回复的流式状态:delta 先累计到 ref,每 100 ms 刷一次 state;
 * 流结束(完成 / 出错 / 中止)后失效对话与对话列表,等重新取到服务端落库的消息再清掉流式文字。
 */
export function useAiStream(chatId: string, classId: string) {
  const qc = useQueryClient()
  const [streaming, setStreaming] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<AiStreamError | null>(null)
  const [lastBody, setLastBody] = useState<AiReplyInput | null>(null)
  const buf = useRef('')
  const ctrl = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // 延后一拍:StrictMode 的"模拟卸载"会立刻重新挂载,此时不能中断请求
      setTimeout(() => {
        if (mounted.current) return
        ctrl.current?.abort()
        clearTimer()
      }, 0)
    }
  }, [])

  /** 返回 false 表示上一次生成还没结束,这次请求被拒绝。 */
  const start = useCallback((body: AiReplyInput): boolean => {
    if (ctrl.current) return false
    const mine = new AbortController()
    ctrl.current = mine
    buf.current = ''
    setText('')
    setError(null)
    setLastBody(body)
    setStreaming(true)
    timer.current = setInterval(() => setText(buf.current), FLUSH_MS)

    let finished = false
    let streamError: AiStreamError | null = null
    let aborted = false
    let neverStarted = false

    aiApi
      .reply(chatId, body, {
        onDelta: (t) => { buf.current += t },
        onDone: () => { finished = true },
        onError: (e) => { finished = true; streamError = e },
      }, mine.signal)
      .then(() => {
        if (!finished) streamError = BROKEN
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') { aborted = true; return }
        if (e instanceof ApiError) {
          neverStarted = true
          if (e.code === 'AI_BUSY') toast('这个对话正在生成,请稍候')
          else streamError = { code: e.code, message: e.message }
          return
        }
        streamError = BROKEN
      })
      .then(async () => {
        clearTimer()
        // 流一结束就释放,之后(含中止后的延迟刷新期间)可以立刻开始下一次
        if (ctrl.current === mine) ctrl.current = null
        setStreaming(false)
        if (streamError) setError(streamError)
        setText(neverStarted ? '' : buf.current)
        if (aborted) await new Promise((r) => setTimeout(r, ABORT_REFETCH_MS))
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['ai-chat', chatId] }),
          qc.invalidateQueries({ queryKey: ['ai-chats', classId] }),
        ])
        if (ctrl.current === null) {
          buf.current = ''
          setText('')
        }
      })
    return true
  }, [chatId, classId, qc])

  const stop = useCallback(() => { ctrl.current?.abort() }, [])

  return { streaming, text, error, lastBody, start, stop }
}
