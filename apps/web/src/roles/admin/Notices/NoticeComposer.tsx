import { useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import type { NoticePerson, NoticeTarget } from '@/shared/types/admin'
import TargetPicker, { MAX_USERS, type TargetKind } from './TargetPicker'

/** 左侧编写区。schoolWide:发送人有学校作用域(可发全校);年级组长为 false */
export default function NoticeComposer({ schoolWide }: { schoolWide: boolean }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<TargetKind>(schoolWide ? 'school' : 'grade')
  const [pickedGrade, setPickedGrade] = useState<string | null>(null)
  const [classId, setClassId] = useState('')
  const [users, setUsers] = useState<NoticePerson[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')

  const needsBoard = kind === 'grade' || kind === 'class'
  const board = useQuery({
    queryKey: ['admin', 'board', pickedGrade],
    queryFn: () => adminApi.board(pickedGrade),
    enabled: needsBoard,
    placeholderData: keepPreviousData,
  })
  const grades = board.data?.grades ?? []
  const gradeId = pickedGrade ?? board.data?.grade_id ?? ''
  // 换年级后、新年级的班级还没到时,不展示上一个年级的班
  const boardForPicker = board.data && board.isPlaceholderData ? { ...board.data, classes: [] } : board.data
  const klass = boardForPicker?.classes.find((c) => c.id === classId)

  let target: NoticeTarget | null = null
  let label = ''
  if (kind === 'school') {
    target = { kind: 'school' }
    label = '全校老师'
  } else if (kind === 'grade' && gradeId) {
    target = { kind: 'grade', grade_id: gradeId }
    label = `${grades.find((g) => g.id === gradeId)?.name ?? ''}老师`
  } else if (kind === 'class' && klass) {
    target = { kind: 'class', class_id: klass.id }
    label = `${klass.name}老师`
  } else if (kind === 'users' && users.length > 0 && users.length <= MAX_USERS) {
    target = { kind: 'users', user_ids: users.map((u) => u.user_id) }
    label = `指定 ${users.length} 人`
  }
  const canSend = title.trim() !== '' && content.trim() !== '' && target !== null

  const changeGrade = (id: string) => { setPickedGrade(id); setClassId('') }
  const changeKind = (k: TargetKind) => { setKind(k); setClassId('') }

  const send = async () => {
    if (!target || busy) return
    setError('')
    setBusy(true)
    try {
      const res = await adminApi.sendNotice({ title: title.trim(), content: content.trim(), target })
      setResult(`已发给 ${res.recipients} 人`)
      setTitle('')
      setContent('')
      setConfirming(false)
      void qc.invalidateQueries({ queryKey: ['notices', 'sent'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'today'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发送失败,请重试')
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
      <TargetPicker
        schoolWide={schoolWide} kind={kind} onKind={changeKind}
        board={boardForPicker} boardError={board.isError && !board.data} onRetryBoard={() => void board.refetch()}
        gradeId={gradeId} onGrade={changeGrade} classId={classId} onClass={setClassId}
        users={users} onUsers={setUsers}
      />
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">{result}</p>
        <Button type="button" disabled={!canSend}
          onClick={() => { setError(''); setResult(''); setConfirming(true) }}>
          发送
        </Button>
      </div>
      {confirming && (
        <Modal open onClose={() => setConfirming(false)} title="发送通知">
          <p className="text-sm">{`确认发给 ${label}?`}</p>
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
