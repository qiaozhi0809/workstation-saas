import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBlocker } from 'react-router-dom'
import { examsApi } from '@/shared/api/exams'
import { confirmLeave, useTeacherStore } from '@/shared/stores/teacher'
import type { ScoreCell, ScoreSheet } from '@/shared/types/grades'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 600
const BATCH = 2000

const keyOf = (c: ScoreCell) => `${c.enrollment_id}|${c.subject}`

/** 把已保存的格子合并进成绩表缓存:null = 清空(删 key),'absent' = 缺考(null)。 */
function mergeCells(sheet: ScoreSheet, cells: ScoreCell[]): ScoreSheet {
  const byId = new Map(
    sheet.items.map((it) => [it.enrollment_id, { ...it, scores: { ...it.scores } }]),
  )
  for (const c of cells) {
    let it = byId.get(c.enrollment_id)
    if (!it) {
      it = { enrollment_id: c.enrollment_id, scores: {} }
      byId.set(c.enrollment_id, it)
    }
    if (c.value === null) delete it.scores[c.subject]
    else it.scores[c.subject] = c.value === 'absent' ? null : c.value
  }
  return { ...sheet, items: [...byId.values()] }
}

/**
 * 成绩自动保存:600 ms 防抖合并(同格后者覆盖前者),每次请求最多 2000 格;
 * 失败保留队列并置 error,retry() 立即重发。有未保存内容时拦截站内跳转与刷新。
 * flush() 立即发送并等到队列发完(导出前用它,导出的表才含刚改的格子),返回是否全部保存成功。
 */
export function useScoreAutosave({ classId, examId }: { classId: string; examId: string }) {
  const qc = useQueryClient()
  const pending = useRef(new Map<string, ScoreCell>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 正在进行的一轮发送;再次 flush 只是等它结束 */
  const inflight = useRef<Promise<boolean> | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [dirty, setDirty] = useState(false)

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (inflight.current) return inflight.current
    if (pending.current.size === 0) {
      setStatus('idle')
      setDirty(false)
      return Promise.resolve(true)
    }
    const sheetKey = ['score-sheet', classId, examId]
    const run = (async () => {
      setStatus('saving')
      try {
        // 发送期间又有新改动:同一轮里接着发
        while (pending.current.size > 0) {
          const all = [...pending.current.values()]
          for (let i = 0; i < all.length; i += BATCH) {
            const chunk = all.slice(i, i + BATCH)
            await examsApi.saveScores(classId, examId, chunk)
            qc.setQueryData<ScoreSheet>(sheetKey, (old) => (old ? mergeCells(old, chunk) : old))
            for (const c of chunk)
              if (pending.current.get(keyOf(c)) === c) pending.current.delete(keyOf(c))
          }
        }
      } catch {
        if (pending.current.size === 0) {
          setStatus('idle')
          setDirty(false)
        } else setStatus('error')
        return false
      }
      setStatus('saved')
      setDirty(false)
      void qc.invalidateQueries({ queryKey: ['exams', classId] })
      void qc.invalidateQueries({ queryKey: ['gradebook', classId] })
      return true
    })()
    inflight.current = run
    void run.finally(() => {
      if (inflight.current === run) inflight.current = null
    })
    return run
  }, [qc, classId, examId])

  const queue = useCallback(
    (cells: ScoreCell[]) => {
      if (cells.length === 0) return
      for (const c of cells) pending.current.set(keyOf(c), c)
      setDirty(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS)
    },
    [flush],
  )

  /** 撤回还没发出去的格子(文字被拒绝后不能留着前一次按键的值) */
  const discard = useCallback((keys: string[]) => {
    for (const k of keys) pending.current.delete(k)
    if (pending.current.size === 0 && !inflight.current) {
      clearTimeout(timer.current)
      timer.current = undefined
      setDirty(false)
      setStatus((s) => (s === 'error' ? 'idle' : s))
    }
  }, [])

  const retry = useCallback(() => {
    void flush()
  }, [flush])

  // 卸载时还没发出去的改动立刻发送,不丢
  useEffect(
    () => () => {
      if (pending.current.size > 0) void flush()
    },
    [flush],
  )

  // 顶栏换班 / 退出登录不走路由,靠 store 里的标记拦截
  const setUnsaved = useTeacherStore((s) => s.setUnsaved)
  useEffect(() => {
    setUnsaved('scores', dirty)
  }, [dirty, setUnsaved])
  useEffect(() => () => setUnsaved('scores', false), [setUnsaved])

  useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  // 换页面或换考试(?exam= 变化)都算离开
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      useTeacherStore.getState().unsaved.scores &&
      (nextLocation.pathname !== currentLocation.pathname ||
        new URLSearchParams(nextLocation.search).get('exam') !==
          new URLSearchParams(currentLocation.search).get('exam')),
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirmLeave(['scores'])) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  return { status, dirty, queue, discard, retry, flush }
}
