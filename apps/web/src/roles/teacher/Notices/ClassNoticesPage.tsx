import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '@/shared/api/client'
import { classesApi } from '@/shared/api/classes'
import { classroomApi } from '@/shared/api/classroom'
import { classNoticesApi } from '@/shared/api/classNotices'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import AckStatsDialog from '@/shared/components/notices/AckStatsDialog'
import { toast } from '@/shared/components/Toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { formatInTz } from '@/shared/lib/date'
import { localTz } from '@/shared/lib/time'
import { useTeacherStore } from '@/shared/stores/teacher'
import type { NoticeSent } from '@/shared/types/admin'
import ClassNoticeComposer from './ClassNoticeComposer'

const PAGE_SIZE = 20

function SentList({ classId }: { classId: string }) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [statsId, setStatsId] = useState<string | null>(null)
  const key = ['class-notices', classId, page]
  const list = useQuery({
    queryKey: key,
    queryFn: () => classNoticesApi.list(classId, page),
    placeholderData: keepPreviousData,
  })
  const recall = useMutation({
    mutationFn: (id: string) => classNoticesApi.recall(classId, id),
    onSuccess: () => {
      toast('已撤回')
      void qc.invalidateQueries({ queryKey: ['class-notices', classId] })
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '撤回失败,请重试'),
  })

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const row = (n: NoticeSent) => (
    <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="break-words font-medium">{n.title}</span>
        <span className="text-xs text-muted-foreground">{formatInTz(n.created_at, localTz())}</span>
        <span className="text-xs">{`已读 ${n.read} / ${n.recipients}`}</span>
        {n.ack.kind !== 'none' && (
          <span className="text-xs">{`回执 ${n.acked} / ${n.recipients}`}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {n.ack.kind !== 'none' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`查看回执 ${n.title}`}
            onClick={() => setStatsId(n.id)}
          >
            回执
          </Button>
        )}
        {n.recalled_at ? (
          <Badge variant="neutral">已撤回</Badge>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`撤回 ${n.title}`}
            disabled={recall.isPending}
            onClick={() => {
              if (window.confirm(`确认撤回「${n.title}」?撤回后家长将看不到正文。`))
                recall.mutate(n.id)
            }}
          >
            撤回
          </Button>
        )}
      </div>
    </li>
  )

  return (
    <section aria-label="我发出的" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">我发出的</h2>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState
          title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="还没有发出过通知" />
      ) : (
        <ul className="flex flex-col divide-y">{list.data.items.map(row)}</ul>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{`共 ${total} 条,第 ${page} / ${pages} 页`}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      {statsId && (
        <AckStatsDialog key={statsId} noticeId={statsId} onClose={() => setStatsId(null)} />
      )}
    </section>
  )
}

export default function ClassNoticesPage() {
  const classId = useTeacherStore((s) => s.classId)
  const classes = useQuery({ queryKey: ['my-classes'], queryFn: classesApi.mine })
  const cls = classes.data?.items.find((c) => c.id === classId)
  // 班级列表到了、当前 classId 却不在里面(被移出该班 / 旧地址):不再一直转圈(L91);
  // TeacherLayout 随后会把当前班重置为第一个,这里先把话说清楚
  const unknownClass = !!classId && !!classes.data && !cls
  // 与导航、教室页同一个 key,共用缓存;页面自己也判权,直接打开 URL 不会发班级公告请求;
  // 班级列表确认有这个班才去取概况,不给不存在的班发请求
  const summary = useQuery({
    queryKey: ['classroom', classId],
    queryFn: () => classroomApi.summary(classId!),
    enabled: !!cls,
  })
  const [composerKey, setComposerKey] = useState(0)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold">班级公告</h1>
      {classes.isError && !classes.data ? (
        <ErrorState
          title="班级加载失败"
          onRetry={() => void classes.refetch()}
          retrying={classes.isFetching}
        />
      ) : unknownClass ? (
        <EmptyState
          title="这个班不在你的班级列表里"
          className="justify-center p-6"
          action={
            <Link to="/teacher/classroom" className="text-sm text-primary underline">
              ← 返回教室
            </Link>
          }
        />
      ) : !cls || summary.isPending ? (
        <LoadingState />
      ) : summary.isError && !summary.data ? (
        <ErrorState
          title="权限加载失败"
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      ) : !summary.data?.my_perms.includes('class.notice') ? (
        <EmptyState title="只有本班班主任可以发班级公告" className="justify-center p-6" />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <ClassNoticeComposer
            key={`${cls.id}-${composerKey}`}
            classId={cls.id}
            className={cls.name}
            onSent={() => setComposerKey((k) => k + 1)}
          />
          <SentList key={cls.id} classId={cls.id} />
        </div>
      )}
    </div>
  )
}
