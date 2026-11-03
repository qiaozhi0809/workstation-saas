import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { aiApi } from '@/shared/api/ai'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import type { AiChat } from '@/shared/types/ai'

const FLUSH_MS = 100
const ABORT_REFETCH_MS = 500
const BROKEN = '连接中断了,可以点「继续生成」'

type Outcome = 'next' | 'end'
/** 服务商层面的永久性错误:继续跑后面的条目只会重复失败 */
const PERMANENT = new Set(['AI_KEY_INVALID', 'AI_QUOTA', 'AI_MODEL_NOT_FOUND', 'AI_UNREACHABLE'])

/**
 * 批量生成:开始时给 wait / err 的条目拍一张快照,按顺序一次一条地跑(一遍里失败的不重试);
 * delta 先进 ref,每 100 ms 刷一次 liveText;每条结束失效对话,整遍结束再失效对话列表。
 * `?go=1` 进来时自动开始一次,并把地址里的 go 去掉。
 */
export function useBatchRunner(chat: AiChat) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [running, setRunning] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const itemsRef = useRef(chat.items)
  itemsRef.current = chat.items
  const buf = useRef('')
  const ctrl = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const active = useRef(false)
  const stopped = useRef(false)
  const mounted = useRef(true)
  const goHandled = useRef(false)

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
        stopped.current = true
        ctrl.current?.abort()
        clearTimer()
      }, 0)
    }
  }, [])

  const runOne = useCallback(async (itemId: string): Promise<Outcome> => {
    const mine = new AbortController()
    ctrl.current = mine
    buf.current = ''
    setLiveText('')
    setCurrentId(itemId)
    timer.current = setInterval(() => setLiveText(buf.current), FLUSH_MS)
    let finished = false
    let outcome: Outcome = 'next'
    let aborted = false
    try {
      await aiApi.runItem(chat.id, itemId, {
        onDelta: (t) => { buf.current += t },
        onDone: () => { finished = true },
        onError: (e) => {
          finished = true
          if (PERMANENT.has(e.code)) { outcome = 'end'; toast(e.message) }
        },
      }, mine.signal)
      if (!finished) { toast(BROKEN); outcome = 'end' }
    } catch (e) {
      outcome = 'end'
      if (e instanceof Error && e.name === 'AbortError') aborted = true
      else if (e instanceof ApiError) {
        if (e.code === 'AI_NOT_CONFIGURED') setNotConfigured(true)
        else if (e.code === 'AI_BUSY') toast('这个对话正在生成,请稍候')
        else toast(e.message)
      } else toast(BROKEN)
    }
    clearTimer()
    if (mounted.current) setLiveText(buf.current)
    ctrl.current = null
    if (aborted) await new Promise((r) => setTimeout(r, ABORT_REFETCH_MS))
    if (mounted.current) {
      await qc.invalidateQueries({ queryKey: ['ai-chat', chat.id] })
      buf.current = ''
      setLiveText('')
      setCurrentId(null)
    }
    return outcome
  }, [chat.id, qc])

  const start = useCallback(() => {
    if (active.current) return
    const queue = itemsRef.current.filter((i) => i.status === 'wait' || i.status === 'err').map((i) => i.id)
    if (queue.length === 0) return
    active.current = true
    stopped.current = false
    setNotConfigured(false)
    setRunning(true)
    void (async () => {
      for (const id of queue) {
        if (stopped.current) break
        if ((await runOne(id)) === 'end') break
      }
      active.current = false
      if (mounted.current) setRunning(false)
      void qc.invalidateQueries({ queryKey: ['ai-chats', chat.class_id] })
    })()
  }, [chat.class_id, qc, runOne])

  const stop = useCallback(() => {
    stopped.current = true
    ctrl.current?.abort()
  }, [])

  useEffect(() => {
    if (goHandled.current) return
    if (new URLSearchParams(location.search).get('go') !== '1') return
    goHandled.current = true
    start()
    navigate({ pathname: location.pathname }, { replace: true })
  }, [location.pathname, location.search, navigate, start])

  return { running, currentId, liveText, notConfigured, start, stop }
}
