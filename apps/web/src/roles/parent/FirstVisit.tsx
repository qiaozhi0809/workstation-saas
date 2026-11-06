import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { preferencesApi } from '@/shared/api/preferences'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'

/**
 * 家长首次进入时页面顶部的说明卡。状态存后端 preferences.onboarded.parent(与老师那边各自只出现一次),
 * 偏好没加载成功或后端还没有 onboarded 字段时不显示。
 */
export default function FirstVisit() {
  const queryClient = useQueryClient()
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: preferencesApi.get })
  const [dismissed, setDismissed] = useState(false)

  // 没加载成功 / 旧后端没有 onboarded / 已看过:都不显示
  const data = prefs.data
  if (dismissed || !data?.onboarded || data.onboarded.parent) return null
  const { teacher_figure, idle_animation, review_reasons } = data

  const dismiss = () => {
    setDismissed(true)
    // 发偏好整体;onboarded 只带 parent 这一个键,服务端按键合并(R7)
    preferencesApi
      .save({
        teacher_figure,
        idle_animation,
        review_reasons,
        onboarded: { parent: new Date().toISOString() },
      })
      .then((saved) => queryClient.setQueryData(['preferences'], saved))
      .catch((err: unknown) =>
        toast(
          err instanceof ApiError ? err.message : '没记住你已看过这条说明,下次进入会再显示一次',
        ),
      )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4">
      <section
        aria-label="首次使用提示"
        className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-card-foreground sm:flex-row sm:items-center"
      >
        <Sparkles className="hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden="true" />
        <p className="min-w-0 flex-1 leading-relaxed">
          这里可以看到孩子的今日出勤、点评、成绩和成长记录;学校的通知会出现在「通知」里
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] shrink-0 sm:min-h-0"
          onClick={dismiss}
        >
          知道了
        </Button>
      </section>
    </div>
  )
}
