import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { studentsApi } from '@/shared/api/students'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import SidePanel from '@/shared/components/overlay/SidePanel'
import { SegmentedTabs } from '@/shared/components/ui/segmented-tabs'
import ArchiveTab from './ArchiveTab'
import CommentsTab from './CommentsTab'
import GrowthTab from './GrowthTab'
import OverviewTab from './OverviewTab'
import ParentsTab from './ParentsTab'
import ProfileActions from './ProfileActions'
import ScoresTab from './ScoresTab'
import { PROFILE_TABS, useStudentDrawer, type ProfileTab } from './useStudentDrawer'

const TAB_ITEMS: readonly { value: ProfileTab; label: string }[] = PROFILE_TABS.map((t) => ({
  value: t,
  label: t,
}))

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

  // 与 ProfileActions / CommentsTab 共用同一个查询键,只有 parent.manage 才显示"家长"页签
  const summary = useQuery({
    queryKey: ['classroom', data?.class_id],
    queryFn: () => classroomApi.summary(data!.class_id),
    enabled: !!data,
  })
  const canManageParents = !!summary.data?.my_perms?.includes('parent.manage')
  const tabItems = canManageParents ? TAB_ITEMS : TAB_ITEMS.filter((t) => t.value !== '家长')

  const retryable = !(error instanceof ApiError && (error.status === 403 || error.status === 404))

  return (
    <SidePanel
      open
      onClose={close}
      title={data ? data.name : error ? '学生档案' : '加载中…'}
      className="w-full sm:max-w-[480px]"
    >
      {error && (
        <ErrorState
          title={errorText(error)}
          onRetry={retryable ? () => void refetch() : undefined}
          retrying={isFetching}
        />
      )}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <ProfileActions profile={data} />
          <SegmentedTabs<ProfileTab>
            label="档案分区"
            variant="underline"
            className="touch-tabs"
            items={tabItems}
            value={tab}
            onChange={(t) => open(studentId, t)}
          />
          <div role="tabpanel" aria-label={tab}>
            {(tab === '概览' || (tab === '家长' && !canManageParents)) && (
              <OverviewTab student={data} />
            )}
            {tab === '档案' && <ArchiveTab student={data} />}
            {tab === '成绩' && <ScoresTab profile={data} />}
            {tab === '成长记录' && <GrowthTab profile={data} />}
            {tab === '评语' && <CommentsTab profile={data} />}
            {tab === '家长' && canManageParents && <ParentsTab profile={data} />}
          </div>
        </>
      )}
    </SidePanel>
  )
}
