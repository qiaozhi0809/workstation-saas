import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { reviewsApi } from '@/shared/api/reviews'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { formatInTz } from '@/shared/lib/date'
import { TONE_TEXT, scoreTone } from '@/shared/lib/tone'
import type { StudentProfile } from '@/shared/types/student'

/** 某个学生最近的点评(前 40 条,不分页);给分人可以撤销自己的那一条 */
export default function ReviewDetail({ profile }: { profile: StudentProfile }) {
  const { class_id: classId, enrollment_id: enrollmentId } = profile
  const queryClient = useQueryClient()
  const summary = useQuery({
    queryKey: ['classroom', classId],
    queryFn: () => classroomApi.summary(classId),
  })
  const canRead = summary.data?.my_perms.includes('review.read') ?? false
  const canWrite = summary.data?.my_perms.includes('review.write') ?? false
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['student-reviews', classId, enrollmentId],
    queryFn: () => reviewsApi.listForStudent(classId, enrollmentId, 40),
    enabled: canRead,
  })
  const revoke = useMutation({
    mutationFn: (reviewId: string) => reviewsApi.revokeItem(classId, reviewId),
    onSuccess: async () => {
      toast('已撤销')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-reviews', classId, enrollmentId] }),
        queryClient.invalidateQueries({ queryKey: ['review-summary', classId] }),
        queryClient.invalidateQueries({ queryKey: ['reviews', classId, 'feed'] }),
      ])
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '撤销失败,请重试'),
  })

  // 班级信息出错时由 GrowthTab 接住,这里不重复展示
  if (!canRead || !summary.data) return null
  const timeZone = summary.data.timezone

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">点评明细</h3>
      {error ? (
        <ErrorState title="点评加载失败" onRetry={() => void refetch()} retrying={isFetching} />
      ) : !data ? (
        <LoadingState />
      ) : data.items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">暂无点评</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">
                {formatInTz(r.given_at, timeZone).slice(5)}
              </span>
              <span className="min-w-0 flex-1 break-words">{r.reason_text}</span>
              <span className={`shrink-0 font-medium ${TONE_TEXT[scoreTone(r.score_delta)]}`}>
                {r.score_delta > 0 ? `+${r.score_delta}` : String(r.score_delta)}
              </span>
              {r.given_by_me && canWrite && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(r.id)}
                >
                  撤销
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
