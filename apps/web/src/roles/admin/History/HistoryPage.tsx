import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { Card } from '@/shared/components/ui/card'
import { NativeSelect } from '@/shared/components/ui/native-select'
import { PageContainer, PageHeader } from '@/shared/components/ui/page'
import { groupByGrade } from '../shared/groupByGrade'

const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : null)

export default function HistoryPage() {
  // 从单班页返回时带 ?year=,回到原来那个学年
  const [picked, setPicked] = useState<string | null>(useSearchParams()[0].get('year'))
  const years = useQuery({ queryKey: ['history', 'years'], queryFn: () => adminApi.historyYears() })
  // 选中的学年若已不在列表里(例如刚被回滚),回到最近一个往年
  const stillThere = picked !== null && years.data?.some((y) => y.id === picked)
  const yearId = (stillThere ? picked : years.data?.[0]?.id) ?? ''
  const classes = useQuery({
    queryKey: ['history', 'classes', yearId],
    queryFn: () => adminApi.historyClasses(yearId),
    enabled: yearId !== '',
  })

  if (years.isError) {
    return (
      <PageContainer width="default">
        <PageHeader title="往年班级" />
        {statusOf(years.error) === 403 ? (
          <EmptyState title="没有权限查看往年班级" />
        ) : (
          <ErrorState
            title="加载失败"
            onRetry={() => void years.refetch()}
            retrying={years.isFetching}
          />
        )}
      </PageContainer>
    )
  }
  if (!years.data)
    return (
      <PageContainer width="default">
        <PageHeader title="往年班级" />
        <LoadingState variant="cards" />
      </PageContainer>
    )

  let body
  if (years.data.length === 0) {
    body = <EmptyState title="还没有往年数据,完成第一次学年升级后会出现在这里" />
  } else if (classes.isError) {
    const st = statusOf(classes.error)
    body =
      st === 403 ? (
        <EmptyState title="没有权限查看往年班级" />
      ) : st === 404 ? (
        <EmptyState title="该学年不存在" />
      ) : (
        <ErrorState
          title="加载失败"
          onRetry={() => void classes.refetch()}
          retrying={classes.isFetching}
        />
      )
  } else if (!classes.data) {
    body = <LoadingState variant="cards" />
  } else if (classes.data.length === 0) {
    body = <EmptyState title="该学年没有可查看的班级" />
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {groupByGrade(classes.data).map(({ grade, classes: list }) => (
          <section key={grade} className="flex flex-col gap-3">
            <h2 className="text-base font-medium">{grade}</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((c) => (
                <Card
                  key={c.class_id}
                  className="relative flex flex-col gap-1 p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent"
                >
                  <Link
                    to={`/admin/history/classes/${c.class_id}?year=${yearId}`}
                    className="w-fit rounded-sm text-base font-medium after:absolute after:inset-0 after:z-10 focus-visible:outline-none"
                  >
                    {c.class_name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {c.homeroom_name ? `班主任 ${c.homeroom_name}` : '未设班主任'}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">{`${c.students} 人`}</span>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <PageContainer width="default">
      <PageHeader
        title="往年班级"
        actions={
          years.data.length > 0 ? (
            <NativeSelect
              aria-label="学年"
              className="max-w-full"
              value={yearId}
              onChange={(e) => setPicked(e.target.value)}
            >
              {years.data.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </NativeSelect>
          ) : undefined
        }
      />
      {body}
    </PageContainer>
  )
}
