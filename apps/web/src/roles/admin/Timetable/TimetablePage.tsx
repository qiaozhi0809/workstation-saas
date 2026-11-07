import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { timetableApi } from '@/shared/api/timetable'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { groupByGrade } from '../shared/groupByGrade'
import ClassTimetableGrid from './ClassTimetableGrid'
import PeriodsEditor from './PeriodsEditor'
import TimetableImportDialog from './TimetableImportDialog'

export default function TimetablePage() {
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => timetableApi.periods() })
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => adminApi.classes() })
  const [classId, setClassId] = useState('')
  const [importing, setImporting] = useState(false)
  const list = classes.data ?? []
  const selected = list.some((c) => c.id === classId) ? classId : (list[0]?.id ?? '')

  return (
    <div data-testid="timetable-page" className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">作息与课表</h1>

      {periods.isPending ? (
        <LoadingState />
      ) : periods.isError ? (
        <ErrorState
          title={periods.error instanceof ApiError ? periods.error.message : '加载失败,请重试'}
          onRetry={() => void periods.refetch()}
          retrying={periods.isFetching}
        />
      ) : (
        <PeriodsEditor periods={periods.data} />
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="mr-auto">课表</CardTitle>
          <label className="flex items-center gap-1.5 text-sm">
            班级
            <NativeSelect
              aria-label="班级"
              value={selected}
              disabled={list.length === 0}
              onChange={(e) => setClassId(e.target.value)}
            >
              {groupByGrade(list).map((g) => (
                <optgroup key={g.grade} label={g.grade}>
                  {g.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => setImporting(true)}>
            导入 CSV
          </Button>
        </CardHeader>
        <CardContent>
          {periods.data && periods.data.length === 0 ? (
            <EmptyState title="先在上面设置作息时间,再排课表" />
          ) : classes.isPending ? (
            <LoadingState />
          ) : classes.isError ? (
            <ErrorState
              title={
                classes.error instanceof ApiError ? classes.error.message : '班级加载失败,请重试'
              }
              onRetry={() => void classes.refetch()}
              retrying={classes.isFetching}
            />
          ) : !selected ? (
            <EmptyState title="还没有班级" description="先到组织架构里建年级和班级" />
          ) : periods.data ? (
            <ClassTimetableGrid classId={selected} periods={periods.data} />
          ) : null}
        </CardContent>
      </Card>

      {importing && <TimetableImportDialog onClose={() => setImporting(false)} />}
    </div>
  )
}
