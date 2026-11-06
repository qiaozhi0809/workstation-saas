import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/shared/api/client'
import { classroomApi } from '@/shared/api/classroom'
import { commentsApi } from '@/shared/api/comments'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { aiLink } from '@/shared/lib/aiLink'
import { formatInTz } from '@/shared/lib/date'
import type { StudentProfile } from '@/shared/types/student'

async function copyComment(content: string) {
  try {
    await navigator.clipboard.writeText(content)
    toast('已复制评语')
  } catch {
    toast('复制失败,请手动复制')
  }
}

function AddForm({ profile, canUseAi }: { profile: StudentProfile; canUseAi: boolean }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const save = useMutation({
    mutationFn: () =>
      commentsApi.create(profile.id, { content: content.trim(), generated_by_ai: false }),
    onSuccess: () => {
      setContent('')
      toast('已保存评语')
      return queryClient.invalidateQueries({ queryKey: ['comments', profile.id] })
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '保存失败,请重试'),
  })

  return (
    <div className="mb-4 space-y-2">
      <Textarea
        aria-label="评语内容"
        maxLength={1000}
        rows={4}
        placeholder="写下本学期的评语"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center gap-2">
        {canUseAi && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(aiLink({ tpl: 'comment1', studentId: profile.id }))}
          >
            AI 生成
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={save.isPending || !content.trim()}
          onClick={() => save.mutate()}
        >
          保存评语
        </Button>
      </div>
    </div>
  )
}

function CommentList({ profile, timezone }: { profile: StudentProfile; timezone: string }) {
  const queryClient = useQueryClient()
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['comments', profile.id],
    queryFn: () => commentsApi.list(profile.id),
  })
  const remove = useMutation({
    mutationFn: (id: string) => commentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', profile.id] }),
    onError: (err) => toast(err instanceof ApiError ? err.message : '删除失败,请重试'),
  })

  const share = useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
      commentsApi.setParentVisible(id, visible),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', profile.id] }),
    onError: (err) => toast(err instanceof ApiError ? err.message : '操作失败,请重试'),
  })

  if (error)
    return <ErrorState title="评语加载失败" onRetry={() => void refetch()} retrying={isFetching} />
  if (!data) return <LoadingState />
  if (data.items.length === 0) return <EmptyState icon={MessageSquareText} title="还没有评语" />

  return (
    <ul className="space-y-3">
      {data.items.map((c) => (
        <li key={c.id} className="border-b border-border pb-3 text-sm last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">{c.semester}</span>
            <span className="text-muted-foreground">
              {formatInTz(c.created_at, timezone).slice(0, 10)}
            </span>
            <Badge variant={c.generated_by_ai ? 'info' : 'neutral'}>
              {c.generated_by_ai ? 'AI 生成' : '手写'}
            </Badge>
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => void copyComment(c.content)}
              >
                复制
              </Button>
              {c.can_delete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  disabled={remove.isPending && remove.variables === c.id}
                  onClick={() => {
                    if (window.confirm('删除这条评语?')) remove.mutate(c.id)
                  }}
                >
                  删除
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* 能否切由后端按"学生当前在读班的班主任"给出(can_share,L69 / L70),往年评语也照此 */}
            <button
              type="button"
              role="switch"
              aria-checked={c.parent_visible}
              aria-label="给家长看"
              disabled={!c.can_share || share.isPending}
              onClick={() => share.mutate({ id: c.id, visible: !c.parent_visible })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${c.parent_visible ? 'bg-primary' : 'bg-muted-foreground/40'}`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${c.parent_visible ? 'translate-x-4' : ''}`}
              />
            </button>
            <span aria-hidden="true">给家长看</span>
            {!c.can_share && <span>只有孩子现在的班主任能改</span>}
            {c.generated_by_ai && !c.parent_visible && (
              <span className="text-warning">AI 生成,需确认后才给家长看</span>
            )}
          </div>
          {/* 评语是纯文本,按文本渲染并保留换行 */}
          <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{c.content}</p>
        </li>
      ))}
    </ul>
  )
}

export default function CommentsTab({ profile }: { profile: StudentProfile }) {
  const summary = useQuery({
    queryKey: ['classroom', profile.class_id],
    queryFn: () => classroomApi.summary(profile.class_id),
  })
  if (summary.error)
    return (
      <ErrorState
        title="加载失败"
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
      />
    )
  if (!summary.data) return <LoadingState />
  const perms = summary.data.my_perms
  if (!perms.includes('comment.read'))
    return <EmptyState icon={MessageSquareText} title="只有班主任可以查看评语" />

  return (
    <section>
      {perms.includes('comment.write') && (
        <AddForm profile={profile} canUseAi={perms.includes('ai.class')} />
      )}
      <CommentList profile={profile} timezone={summary.data.timezone} />
    </section>
  )
}
