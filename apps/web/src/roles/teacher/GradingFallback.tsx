import { Button } from '@/shared/components/ui/button'
import type { GradingState } from '@/shared/hooks/useGrading'
import { DEFAULT_GRADING } from '@/shared/lib/grades'

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`

/**
 * 学校及格 / 优秀比例读取失败时的页顶提示(L236):说明当前按默认值着色并给重试;读取正常时不渲染。
 * 成绩页与分析页共用,文案里的默认值取自 DEFAULT_GRADING,改默认值不用改这里。
 */
export default function GradingFallback({ grading }: { grading: GradingState }) {
  if (!grading.failed) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>
        {`及格线读取失败,先按默认 ${pct(DEFAULT_GRADING.pass_ratio)} / ${pct(DEFAULT_GRADING.good_ratio)} 显示`}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={grading.retry}>
        重试
      </Button>
    </div>
  )
}
