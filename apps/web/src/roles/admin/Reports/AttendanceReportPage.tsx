import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import { useState } from 'react'
import { adminApi } from '@/shared/api/admin'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { NativeSelect } from '@/shared/components/ui/native-select'
import AttendanceClassTable from './AttendanceClassTable'

const pad = (n: number) => String(n).padStart(2, '0')
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${y}年${mo}月` }

// 打印:A4 横向,隐藏顶栏导航与按钮,表头每页重复;外层容器放开高度与滚动,否则只会打出一屏
const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  html, body, #root, #root > div, #main { height: auto !important; overflow: visible !important; }
  body > #root header, body > #root a[href="#main"], [data-no-print] { display: none !important; }
  [data-attendance-report] thead { display: table-header-group; }
  [data-attendance-report] tr { break-inside: avoid; }
}
`

export default function AttendanceReportPage() {
  const [month, setMonth] = useState(thisMonth)
  const [gradeId, setGradeId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // 年级选项沿用全校看板的来源(school.view 即可读)
  const boardQ = useQuery({ queryKey: ['admin', 'board', null], queryFn: () => adminApi.board(null) })
  const q = useQuery({
    queryKey: ['report', 'attendance', month, gradeId],
    queryFn: () => adminApi.attendanceReport(month, gradeId),
    placeholderData: keepPreviousData,
  })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const blob = await adminApi.exportAttendance(month, gradeId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `考勤报告-${month}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast('导出失败,请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  const isCurrent = month >= thisMonth()
  const grades = boardQ.data?.grades ?? []

  return (
    <div data-attendance-report className="flex flex-col gap-4 p-4 md:p-6">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">月度考勤报告</h1>
          <p className="text-sm text-muted-foreground">只统计班主任确认过考勤的日子;迟到算出勤</p>
          {q.data && <p className="hidden text-sm print:block">{`${q.data.scope_label} · ${monthLabel(q.data.month)}`}</p>}
        </div>
        <div data-no-print className="flex gap-2">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
            <Download aria-hidden="true" />导出 CSV
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" />打印
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="上一月" data-no-print onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-24 text-center text-sm font-medium" aria-live="polite">{monthLabel(month)}</span>
          <Button variant="outline" size="icon" aria-label="下一月" data-no-print disabled={isCurrent}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <label data-no-print className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">年级</span>
          <NativeSelect aria-label="年级" value={gradeId ?? ''} onChange={(e) => setGradeId(e.target.value || null)}>
            <option value="">全部年级</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </NativeSelect>
        </label>
      </div>

      {q.isError ? (
        <ErrorState title="加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : !q.data ? (
        <LoadingState />
      ) : q.data.classes.length === 0 ? (
        <EmptyState title="暂无班级" />
      ) : (
        <AttendanceClassTable month={month} report={q.data} />
      )}
    </div>
  )
}
