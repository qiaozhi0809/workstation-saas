import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBlocker } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import type { ScoreCell, ScoreSheet } from '@/shared/types/grades'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export const LEAVE_CONFIRM = '还有成绩没保存,确定离开?'
const DEBOUNCE_MS = 600
const BATCH = 2000

const keyOf = (c: ScoreCell) => `${c.enrollment_id}|${c.subject}`

/** 把已保存的格子合并进成绩表缓存:null = 清空(删 key),'absent' = 缺考(null)。 */
function mergeCells(sheet: ScoreSheet, cells: ScoreCell[]): ScoreSheet {
  const byId = new Map(sheet.items.map((it) => [it.enrollment_id, { ...it, scores: { ...it.scores } }]))
  for (const c of cells) {
    let it = byId.get(c.enrollment_id)
    if (!it) { it = { enrollment_id: c.enrollment_id, scores: {} }; byId.set(c.enrollment_id, it) }
    if (c.value === null) delete it.scores[c.subject]
    else it.scores[c.subject] = c.value === 'absent' ? null : c.value
  }
  return { ...sheet, items: [...byId.values()] }
}

/**
 * 成绩自动保存:600 ms 防抖合并(同格后者覆盖前者),每次请求最多 2000 格;
 * 失败保留队列并置 error,retry() 立即重发。有未保存内容时拦截站内跳转与刷新。
 */
export function useScoreAutosave({ classId, examId }: { classId: string; examId: string }) {
  const qc = useQueryClient()
  const pending = useRef(new Map<string, ScoreCell>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sending = useRef(false)
  const dirtyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [dirty, setDirtyState] = useState(false)

  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v) }

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (sending.current || pending.current.size === 0) return
    sending.current = true
    setStatus('saving')
    const sheetKey = ['score-sheet', classId, examId]
    try {
      const all = [...pending.current.values()]
      for (let i = 0; i < all.length; i += BATCH) {
        const chunk = all.slice(i, i + BATCH)
        await examsApi.saveScores(classId, examId, chunk)
        qc.setQueryData<ScoreSheet>(sheetKey, (old) => (old ? mergeCells(old, chunk) : old))
        for (const c of chunk) if (pending.current.get(keyOf(c)) === c) pending.current.delete(keyOf(c))
      }
    } catch {
      sending.current = false
      setStatus('error')
      return
    }
    sending.current = false
    if (pending.current.size > 0) {
      // 发送期间又有新改动:接着发
      void flush()
      return
    }
    setStatus('saved')
    setDirty(false)
    void qc.invalidateQueries({ queryKey: ['exams', classId] })
    void qc.invalidateQueries({ queryKey: ['gradebook', classId] })
  }, [qc, classId, examId])

  const queue = useCallback((cells: ScoreCell[]) => {
    if (cells.length === 0) return
    for (const c of cells) pending.current.set(keyOf(c), c)
    setDirty(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS)
  }, [flush])

  /** 撤回还没发出去的格子(文字被拒绝后不能留着前一次按键的值) */
  const discard = useCallback((keys: string[]) => {
    for (const k of keys) pending.current.delete(k)
    if (pending.current.size === 0 && !sending.current) {
      clearTimeout(timer.current)
      timer.current = undefined
      setDirty(false)
      setStatus((s) => (s === 'error' ? 'idle' : s))
    }
  }, [])

  const retry = useCallback(() => { void flush() }, [flush])

  // 卸载时还没发出去的改动立刻发送,不丢
  useEffect(() => () => {
    if (timer.current) void flush()
  }, [flush])

  useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  // 换页面或换考试(?exam= 变化)都算离开
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirtyRef.current && (
      nextLocation.pathname !== currentLocation.pathname
      || new URLSearchParams(nextLocation.search).get('exam') !== new URLSearchParams(currentLocation.search).get('exam')
    ))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(LEAVE_CONFIRM)) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  return { status, dirty, queue, discard, retry }
}
