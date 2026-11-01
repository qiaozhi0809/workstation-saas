import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/shared/api/client'
import { studentsApi } from '@/shared/api/students'
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer'
import ArchiveTab from './ArchiveTab'
import OverviewTab from './OverviewTab'

const TABS = ['概览', '档案', '成绩', '成长记录', '评语'] as const
type Tab = (typeof TABS)[number]

const errorText = (error: unknown) => {
  if (error instanceof ApiError && error.status === 403) return '没有权限查看该学生'
  if (error instanceof ApiError && error.status === 404) return '未找到该学生'
  return '加载失败'
}

export default function StudentProfileDrawer({ studentId }: { studentId: string }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('概览')
  const { data, error } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => studentsApi.detail(studentId),
  })

  const close = () => navigate('/teacher/classroom', { replace: true })
  useEscapeLayer(true, close)

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-drawer-title"
        className="w-[480px] h-full bg-panel p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id="student-drawer-title" className="text-lg font-semibold">{data ? data.name : error ? '学生档案' : '加载中…'}</h3>
          <button type="button" onClick={close}>关闭</button>
        </div>
        {error && <p>{errorText(error)}</p>}
        {data && (
          <>
            <div role="tablist" className="flex gap-3 border-b mb-3">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={tab === t ? 'font-semibold border-b-2 border-current' : 'text-ink-2'}>
                  {t}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === '概览' && <OverviewTab student={data} />}
              {tab === '档案' && <ArchiveTab student={data} />}
              {tab !== '概览' && tab !== '档案' && <p className="text-ink-3">M2 启用</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
