import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { useMeta } from '@/shared/hooks/useSchoolTz'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

/**
 * "关于":产品名、版本(/meta)、学校名,以及 spec §8.4 的承诺"数据只存在学校自己的服务器上"。
 * 版本与校名用共享的 useMeta(查询键 ['meta'],与其它读 /meta 的地方共用一份缓存),打开时才取。
 * 不放许可证链接(R13)。
 */
export default function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  // 版本与校名几乎不变:['meta'] 里刚取过的直接用,不为打开一次"关于"再请求
  const meta = useMeta({ enabled: open })
  return (
    <Modal open={open} onClose={onClose} title="关于" className="max-w-sm">
      <div className="space-y-4">
        <dl className="space-y-2">
          <Row label="产品">班级工作台</Row>
          {meta.data && (
            <>
              <Row label="版本">{meta.data.version}</Row>
              <Row label="学校">{meta.data.school_name}</Row>
            </>
          )}
        </dl>
        {meta.isPending && <LoadingState className="justify-start py-2" />}
        {meta.isError && (
          <ErrorState
            title="没有取到版本信息"
            onRetry={() => void meta.refetch()}
            retrying={meta.isFetching}
            className="py-2"
          />
        )}
        <p className="text-sm text-muted-foreground">数据只存在学校自己的服务器上。</p>
      </div>
    </Modal>
  )
}
