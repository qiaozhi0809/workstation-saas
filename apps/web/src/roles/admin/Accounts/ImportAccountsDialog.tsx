import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Field, useFormErrors } from '@/shared/components/ui/field'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { downloadText } from '@/shared/lib/csv'
import { cn } from '@/shared/lib/utils'
import type { ImportRow } from '@/shared/types/admin'
import type { TempPassword } from './TempPasswordDialog'

const CSV_ORDER = ['csv'] as const

const TEMPLATE = '登录名,姓名,工号,科目,手机\nteacher21,示例老师,T021,语文、数学,13800000021\n'

export default function ImportAccountsDialog({
  onClose,
  onImported,
}: {
  onClose(): void
  onImported(created: TempPassword[]): void
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const [csv, setCsv] = useState('')
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { errors, report, clear, fieldRef } = useFormErrors(CSV_ORDER)

  const edit = (text: string) => {
    seq.current++
    clear('csv')
    setCsv(text)
    setRows(null)
    setError('')
    setBusy(false)
  }

  const preview = async (text: string) => {
    const mine = ++seq.current
    setBusy(true)
    setError('')
    try {
      const res = await adminApi.importPreview(text)
      if (mine === seq.current) setRows(res.rows)
    } catch (err) {
      if (mine !== seq.current) return
      setRows(null)
      setError(err instanceof ApiError ? err.message : '预览失败,请重试')
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '').replace(/^\uFEFF/, '')
      setCsv(text)
      void preview(text)
    }
    reader.onerror = () => setError('读取文件失败,请重试')
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await adminApi.importAccounts(csv)
      void qc.invalidateQueries({ queryKey: ['admin', 'accounts'] })
      onImported(res.created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '导入失败,请重试')
      setBusy(false)
    }
  }

  const bad = rows?.some((r) => r.error) ?? false

  return (
    <Modal
      open
      onClose={onClose}
      title="批量导入账号"
      dismissOnOutside={false}
      className="max-w-3xl"
    >
      <div className="space-y-3">
        <Field label="粘贴 CSV 内容" error={errors.csv}>
          <Textarea
            ref={fieldRef('csv')}
            rows={5}
            value={csv}
            onChange={(e) => edit(e.target.value)}
            placeholder="选择 CSV 文件,或粘贴内容;表头:登录名,姓名,工号,科目,手机"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="选择 CSV 文件"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            选择 CSV 文件
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadText('账号导入模板.csv', '\uFEFF' + TEMPLATE)}
          >
            下载模板
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!report(csv.trim() ? {} : { csv: '请先粘贴或选择 CSV' })) return
              void preview(csv)
            }}
          >
            预览
          </Button>
        </div>
        {rows && (
          <Table
            density="compact"
            className="min-w-[640px]"
            containerClassName="max-h-72 overflow-auto bg-transparent shadow-none"
          >
            <TableHead>
              <TableRow>
                {['行', '登录名', '姓名', '工号', '科目', '手机'].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
                <Th nowrap={false}>问题</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.line}
                  data-invalid={r.error ? 'true' : undefined}
                  className={cn(r.error && 'bg-destructive/10 text-destructive')}
                >
                  <Td>{r.line}</Td>
                  <Td>{r.login_name}</Td>
                  <Td>{r.display_name}</Td>
                  <Td>{r.employee_no ?? ''}</Td>
                  <Td>{r.subjects.join('、')}</Td>
                  <Td>{r.phone ?? ''}</Td>
                  <Td nowrap={false}>{r.error ?? ''}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !rows || rows.length === 0 || bad}
            onClick={() => void confirm()}
          >
            确认导入
          </Button>
        </div>
      </div>
    </Modal>
  )
}
