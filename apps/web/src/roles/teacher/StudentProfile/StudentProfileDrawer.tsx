import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { Clock } from 'lucide-react'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import SidePanel from '@/shared/components/overlay/SidePanel'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ArchiveTab from './ArchiveTab'
import OverviewTab from './OverviewTab'

const TABS = ['概览', '档案', '成绩', '成长记录', '评语'] as const
type Tab = (typeof TABS)[number]
const TAB_ITEMS: readonly { value: Tab; label: string }[] = TABS.map((t) => ({ value: t, label: t }))

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 403) return '没有权限查看该学生'
  if (error instanceof ApiError && error.status === 404) return '未找到该学生'
  return '加载失败'
}

export default function StudentProfileDrawer({ studentId }: { studentId: string }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('概览')
  const { data, error, refetch } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => studentsApi.detail(studentId),
  })

  const close = () => navigate('/teacher/classroom', { replace: true })
  const retryable = !(error instanceof ApiError && (error.status === 403 || error.status === 404))

  return (
    <SidePanel open onClose={close} title={data ? data.name : error ? '学生档案' : '加载中…'} className="w-full sm:max-w-[480px]">
      {error && <ErrorState title={errorText(error)} onRetry={retryable ? () => void refetch() : undefined} />}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <SegmentedTabs<Tab> label="档案分区" variant="underline" items={TAB_ITEMS} value={tab} onChange={setTab} />
          <div role="tabpanel" aria-label={tab}>
            {tab === '概览' && <OverviewTab student={data} />}
            {tab === '档案' && <ArchiveTab student={data} />}
            {tab !== '概览' && tab !== '档案' && (
              <EmptyState icon={Clock} title="暂未开放" description="成绩、成长记录和评语会在后续版本中提供" />
            )}
          </div>
        </>
      )}
    </SidePanel>
  )
}
