import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/shared/api/ai'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { useAuthStore } from '@/shared/stores/auth'
import type { AiTemplate } from '@/shared/types/ai'
import ClassGate from '../ClassGate'
import Composer from './Composer'
import RecentChats from './RecentChats'
import StatusPill from './StatusPill'
import TemplateGrid from './TemplateGrid'

/** AI 助手首页:问候与状态、自由输入、模板卡片、最近对话。需要本班 ai.use 权限。 */
export default function AiHomePage() {
  const name = useAuthStore((s) => s.user?.display_name ?? '')
  // 点模板后的表单由后续任务接上
  const [, setPicked] = useState<AiTemplate | null>(null)
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status })

  return (
    <ClassGate title="AI 助手" need="ai.use">
      {({ cls, summary, perms }) => (
        <div className="mx-auto max-w-3xl space-y-6 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-lg font-semibold text-foreground">{name}老师,今天想做点什么?</p>
            <StatusPill status={status.data} />
          </div>
          <Composer classId={cls.id} status={status.data} canReadExams={perms.includes('exam.read')} />
          <Templates classId={cls.id} onPick={setPicked} />
          <RecentChats classId={cls.id} timezone={summary.timezone} />
          <p className="text-xs text-muted-foreground">
            只有点击发送或生成时,才会把选中的资料发给学校配置的 AI 服务;家长姓名、电话等联系方式从不发送。
          </p>
        </div>
      )}
    </ClassGate>
  )
}

function Templates({ classId, onPick }: { classId: string; onPick(t: AiTemplate): void }) {
  const q = useQuery({ queryKey: ['ai-templates', classId], queryFn: () => aiApi.templates(classId) })
  if (q.isLoading) return <LoadingState />
  if (!q.data) return <ErrorState title="模板加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
  return <TemplateGrid templates={q.data} onPick={onPick} />
}
