import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { STUDENT_TEMPLATE_CSV, toImportRows } from '@/shared/lib/columns'
import { downloadText } from '@/shared/lib/csv'
import { parseTable } from '@/shared/lib/table'
import type { ClassView } from '@/shared/types/class'
import { invalidateRosterQueries } from './invalidate'

const MAX_ROWS = 200
// STUDENT_TEMPLATE_CSV 不带 BOM,没有它中文 Windows 的 Excel 会乱码
const BOM = '﻿'

export default function ImportDialog({ cls, onClose }: { cls: ClassView; onClose(): void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [autoSeat, setAutoSeat] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => (text.trim() ? toImportRows(parseTable(text)) : null), [text])
  const count = parsed?.rows.length ?? 0
  const tooMany = count > MAX_ROWS

  const submit = async () => {
    if (!parsed || count === 0 || tooMany) return
    setBusy(true)
    setError('')
    try {
      const res = await studentsApi.importRows(cls.id, { rows: parsed.rows, auto_seat: autoSeat })
      void invalidateRosterQueries(qc)
      toast(`导入 ${res.created} 人,跳过重复 ${res.skipped.length} 人`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '导入失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      setError('')
      setText(String(reader.result ?? '').replace(/^\uFEFF/, ''))
    }
    reader.onerror = () => setError('读取文件失败,请重试')
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Modal open onClose={onClose} title="批量导入学生" dismissOnOutside={false} className="max-w-xl">
      <div className="space-y-3">
        <Textarea
          aria-label="粘贴名单" rows={8} value={text} onChange={(e) => { setText(e.target.value); setError('') }}
          placeholder="从 Excel 复制粘贴,或选择 CSV 文件;第一行是表头,至少要有“姓名”列"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" aria-label="选择 CSV 文件" className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>选择 CSV 文件</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadText('学生名单模板.csv', BOM + STUDENT_TEMPLATE_CSV)}>
            下载模板
          </Button>
        </div>
        {parsed && (
          parsed.missingName ? (
            <p className="text-sm text-destructive">第一行要有"姓名"列</p>
          ) : (
            <p className="text-sm text-muted-foreground">{`识别到 ${count} 人,${parsed.columns.length} 列`}</p>
          )
        )}
        {tooMany && <p className="text-sm text-destructive">{`一次最多导入 ${MAX_ROWS} 人,请分批导入`}</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoSeat} onChange={(e) => { setAutoSeat(e.target.checked); setError('') }} />
          自动安排到空座位
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" disabled={busy || count === 0 || tooMany} onClick={() => void submit()}>导入</Button>
        </div>
      </div>
    </Modal>
  )
}
