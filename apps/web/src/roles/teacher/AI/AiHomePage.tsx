import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/shared/api/ai'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { useAuthStore } from '@/shared/stores/auth'
import { Button } from '@/shared/components/ui/button'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import type { AiStatus, AiTemplate, AiValue } from '@/shared/types/ai'
import ClassGate from '../ClassGate'
import Composer from './Composer'
import RecentChats from './RecentChats'
import StatusPill from './StatusPill'
import TemplateForm from './TemplateForm'
import TemplateGrid from './TemplateGrid'
import { useTemplateEntry } from './useTemplateEntry'

/** AI 助手首页:问候与状态、自由输入、模板卡片、最近对话。需要本班 ai.use 权限。 */
export default function AiHomePage() {
  const name = useAuthStore((s) => s.user?.display_name ?? '').trim()
  // 与欢迎页同一风格"你好,X"(L260);姓名没带"老师"时补上
  const who = name === '' ? '' : name.endsWith('老师') ? name : `${name}老师`
  const greeting = who === '' ? '你好' : `你好,${who}`
  const status = useQuery({ queryKey: ['ai-status'], queryFn: aiApi.status })

  return (
    <ClassGate title="AI 助手" need="ai.use" titleMode="none">
      {({ cls, summary, perms }) => (
        <PageContainer width="narrow">
          <PageHeader
            title="AI 助手"
            description={`${greeting},今天想做点什么?`}
            meta={<StatusPill status={status.data} />}
            actions={
              status.isError ? (
                <span className="inline-flex items-center gap-2 text-xs text-destructive">
                  AI 状态加载失败
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void status.refetch()}
                  >
                    重试
                  </Button>
                </span>
              ) : undefined
            }
          />
          <Composer
            classId={cls.id}
            status={status.data}
            canReadExams={perms.includes('exam.read')}
          />
          <Templates classId={cls.id} status={status.data} />
          <RecentChats classId={cls.id} timezone={summary.timezone} />
          <p className="text-xs text-muted-foreground">
            只有点击发送或生成时,才会把选中的资料发给学校配置的 AI
            服务;家长姓名、电话等联系方式从不发送。
          </p>
        </PageContainer>
      )}
    </ClassGate>
  )
}

interface Picked {
  template: AiTemplate
  initial?: Record<string, AiValue>
}

function Templates({ classId, status }: { classId: string; status: AiStatus | undefined }) {
  const q = useQuery({
    queryKey: ['ai-templates', classId],
    queryFn: () => aiApi.templates(classId),
  })
  const [picked, setPicked] = useState<Picked | null>(null)
  useTemplateEntry(
    q.data?.items,
    useCallback((template, initial) => setPicked({ template, initial }), []),
  )
  if (q.isLoading) return <LoadingState variant="cards" />
  if (!q.data)
    return (
      <ErrorState title="模板加载失败" onRetry={() => void q.refetch()} retrying={q.isFetching} />
    )
  return (
    <>
      <TemplateGrid templates={q.data} onPick={(template) => setPicked({ template })} />
      {picked && (
        <TemplateForm
          key={picked.template.id}
          template={picked.template}
          classId={classId}
          initial={picked.initial}
          status={status}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}
