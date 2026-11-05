import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { downloadText } from '@/shared/lib/csv'
import { cn } from '@/shared/lib/utils'
import type { ImportRow } from '@/shared/types/admin'
import type { TempPassword } from './TempPasswordDialog'

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

  const edit = (text: string) => {
    seq.current++
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
        <Textarea
          aria-label="粘贴 CSV 内容"
          rows={5}
          value={csv}
          onChange={(e) => edit(e.target.value)}
          placeholder="选择 CSV 文件,或粘贴内容;表头:登录名,姓名,工号,科目,手机"
        />
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
            disabled={busy || !csv.trim()}
            onClick={() => void preview(csv)}
          >
            预览
          </Button>
        </div>
        {rows && (
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  {['行', '登录名', '姓名', '工号', '科目', '手机', '问题'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.line}
                    data-invalid={r.error ? 'true' : undefined}
                    className={cn('border-t', r.error && 'bg-destructive/10 text-destructive')}
                  >
                    <td className="px-3 py-1.5">{r.line}</td>
                    <td className="px-3 py-1.5">{r.login_name}</td>
                    <td className="px-3 py-1.5">{r.display_name}</td>
                    <td className="px-3 py-1.5">{r.employee_no ?? ''}</td>
                    <td className="px-3 py-1.5">{r.subjects.join('、')}</td>
                    <td className="px-3 py-1.5">{r.phone ?? ''}</td>
                    <td className="px-3 py-1.5">{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
