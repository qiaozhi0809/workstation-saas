import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { Clock } from 'lucide-react'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import SidePanel from '@/shared/components/overlay/SidePanel'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ArchiveTab from './ArchiveTab'
import GrowthTab from './GrowthTab'
import OverviewTab from './OverviewTab'
import ScoresTab from './ScoresTab'
import { PROFILE_TABS, useStudentDrawer, type ProfileTab } from './useStudentDrawer'

const TAB_ITEMS: readonly { value: ProfileTab; label: string }[] = PROFILE_TABS.map((t) => ({ value: t, label: t }))

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 403) return '没有权限查看该学生'
  if (error instanceof ApiError && error.status === 404) return '未找到该学生'
  return '加载失败'
}

export default function StudentProfileDrawer({ studentId }: { studentId: string }) {
  // 当前页签与关闭都走地址参数(?tab= / ?student=)
  const { tab, open, close } = useStudentDrawer()
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => studentsApi.detail(studentId),
  })

  const retryable = !(error instanceof ApiError && (error.status === 403 || error.status === 404))

  return (
    <SidePanel open onClose={close} title={data ? data.name : error ? '学生档案' : '加载中…'} className="w-full sm:max-w-[480px]">
      {error && <ErrorState title={errorText(error)} onRetry={retryable ? () => void refetch() : undefined} retrying={isFetching} />}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <SegmentedTabs<ProfileTab> label="档案分区" variant="underline" items={TAB_ITEMS} value={tab} onChange={(t) => open(studentId, t)} />
          <div role="tabpanel" aria-label={tab}>
            {tab === '概览' && <OverviewTab student={data} />}
            {tab === '档案' && <ArchiveTab student={data} />}
            {tab === '成绩' && <ScoresTab profile={data} />}
            {tab === '成长记录' && <GrowthTab profile={data} />}
            {/* 评语页签尚未开放 */}
            {tab === '评语' && (
              <EmptyState icon={Clock} title="暂未开放" description="评语会在后续版本中提供" />
            )}
          </div>
        </>
      )}
    </SidePanel>
  )
}
