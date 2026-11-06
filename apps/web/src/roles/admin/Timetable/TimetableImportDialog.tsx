import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { timetableApi } from '@/shared/api/timetable'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { downloadText } from '@/shared/lib/csv'
import type { TimetableImportResult } from '@/shared/types/timetable'

const TEMPLATE =
  '班级,星期,节次,科目,工号\n三年二班,周一,1,语文,T001\n三年二班,周一,2,数学,\n三年二班,星期二,1,英语,T003\n'

/** 整校课表 CSV 导入:后端全部通过才写入,这里逐行列出问题 */
export default function TimetableImportDialog({ onClose }: { onClose(): void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<TimetableImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = (f: File | undefined) => {
    setFile(f ?? null)
    setResult(null)
    setError('')
  }

  const submit = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await timetableApi.importCsv(file)
      if (!res.ok) {
        setResult(res)
        return
      }
      // 导入会整班替换出现过的班,全部课表与教室概况都重新拉
      void qc.invalidateQueries({ queryKey: ['timetable'] })
      void qc.invalidateQueries({ queryKey: ['classroom'] })
      toast(`已导入 ${res.written} 节课`)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '导入失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="导入课表 CSV"
      dismissOnOutside={false}
      className="max-w-2xl"
    >
      <div data-testid="timetable-import-dialog" className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          表头:班级,星期,节次,科目,工号。星期写
          1–7、周一或星期一都行;工号留空就按组织架构自动匹配老师。
          文件里出现的班级会被整班替换;只要有一行有问题就一行也不写入。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="选择 CSV 文件"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
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
            onClick={() => downloadText('课表导入模板.csv', '\uFEFF' + TEMPLATE)}
          >
            下载模板
          </Button>
          <span className="truncate text-muted-foreground">
            {file ? file.name : '还没有选择文件'}
          </span>
        </div>
        {result && !result.ok && (
          <div className="space-y-2">
            <p role="alert" className="text-destructive">
              {`有 ${result.errors.length} 行有问题,这次没有写入任何数据;修正后重新导入。`}
            </p>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-16 px-3 py-2 font-medium">
                      行
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      问题
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={`${e.line}-${i}`} className="border-t">
                      <td className="px-3 py-1.5">{e.line}</td>
                      <td className="px-3 py-1.5">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" disabled={busy || !file} onClick={() => void submit()}>
            导入
          </Button>
        </div>
      </div>
    </Modal>
  )
}
