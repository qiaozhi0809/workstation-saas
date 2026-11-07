import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { NativeSelect } from '@/shared/components/ui/native-select'
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
    return statusOf(years.error) === 403 ? (
      <EmptyState title="没有权限查看往年班级" className="p-6" />
    ) : (
      <ErrorState
        title="加载失败"
        onRetry={() => void years.refetch()}
        retrying={years.isFetching}
        className="p-6"
      />
    )
  }
  if (!years.data) return <LoadingState />

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
    body = <LoadingState />
  } else if (classes.data.length === 0) {
    body = <EmptyState title="该学年没有可查看的班级" />
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {groupByGrade(classes.data).map(({ grade, classes: list }) => (
          <section key={grade} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{grade}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((c) => (
                <Link
                  key={c.class_id}
                  to={`/admin/history/classes/${c.class_id}?year=${yearId}`}
                  className="flex flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-base font-semibold">{c.class_name}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.homeroom_name ? `班主任 ${c.homeroom_name}` : '未设班主任'}
                  </span>
                  <span className="text-sm text-muted-foreground">{`${c.students} 人`}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">往年班级</h1>
        {years.data.length > 0 && (
          <NativeSelect
            aria-label="学年"
            className="w-fit max-w-full"
            value={yearId}
            onChange={(e) => setPicked(e.target.value)}
          >
            {years.data.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </header>
      {body}
    </div>
  )
}
