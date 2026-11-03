import type { AiStatus } from '@/shared/types/ai'

/** AI 服务状态:已配置显示服务商,未配置提示可以复制提示词;加载中不显示。 */
export default function StatusPill({ status }: { status: AiStatus | undefined }) {
  if (!status) return null
  if (status.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
        {status.provider_label}
      </span>
    )
  }
  return (
    <span
      title="可以先用「复制提示词」,把提示词贴到任意 AI 工具里"
      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
    >
      未配置 AI 服务
    </span>
  )
}
