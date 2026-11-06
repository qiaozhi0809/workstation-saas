import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { EmptyState } from '@/shared/components/feedback/EmptyState'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import type { CameraOut, CameraStatus } from '@/shared/types/camera'
import CameraForm from './CameraForm'
import CameraTestDialog from './CameraTestDialog'

const STATUS: Record<CameraStatus, { label: string; dot: string }> = {
  idle: { label: '空闲', dot: 'bg-muted-foreground/50' },
  streaming: { label: '直播中', dot: 'bg-success' },
  error: { label: '异常', dot: 'bg-destructive' },
}

type Dialog =
  | { kind: 'form'; camera?: CameraOut }
  | { kind: 'test'; camera: CameraOut }
  | { kind: 'delete'; camera: CameraOut }
  | null

function StatusCell({ camera }: { camera: CameraOut }) {
  const s = STATUS[camera.status]
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', s.dot)} />
        {s.label}
      </span>
      {camera.status === 'error' && camera.last_error && (
        <p className="max-w-[16rem] truncate text-xs text-destructive" title={camera.last_error}>
          {camera.last_error}
        </p>
      )}
    </div>
  )
}

export default function CamerasPage() {
  const qc = useQueryClient()
  const switches = useQuery({ queryKey: ['admin', 'switches'], queryFn: () => adminApi.switches() })
  const monitorOff = switches.data ? !switches.data.monitor : false
  // 开关关着时后端对摄像头接口一律 404:先等开关结果再拉列表(开关读不到就照常拉,404 时同样当作关着)
  const fetchCameras = !switches.isPending && !monitorOff
  const list = useQuery({
    queryKey: ['cameras'],
    queryFn: () => camerasApi.list(),
    enabled: fetchCameras,
  })
  const health = useQuery({
    queryKey: ['cameras', 'health'],
    queryFn: () => camerasApi.health(),
    enabled: fetchCameras,
  })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const off =
    monitorOff || (list.isError && list.error instanceof ApiError && list.error.status === 404)
  // ['cameras'] 前缀连带 health / 各班摄像头;全校看板的九宫格用的是另一个键
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cameras'] })
    void qc.invalidateQueries({ queryKey: ['camera-wall'] })
  }

  const toggle = async (c: CameraOut) => {
    if (togglingId) return
    setTogglingId(c.id)
    try {
      // 不带 username / password = 不改凭据
      await camerasApi.update(c.id, {
        name: c.name,
        class_id: c.class_id,
        location: c.location,
        rtsp_url: c.rtsp_url ?? '',
        enabled: !c.enabled,
        transcode: c.transcode,
      })
      toast(`${c.enabled ? '已停用' : '已启用'}${c.name}`)
      refresh()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '操作失败,请重试')
    } finally {
      setTogglingId(null)
    }
  }

  const remove = async () => {
    if (dialog?.kind !== 'delete' || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await camerasApi.remove(dialog.camera.id)
      toast(`已删除${dialog.camera.name}`)
      setDialog(null)
      refresh()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : '删除失败,请重试')
    } finally {
      setDeleting(false)
    }
  }

  const publicHosts = health.data?.public_hosts ?? []

  return (
    <div data-testid="cameras-page" className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">摄像头</h1>
        <Button type="button" disabled={off} onClick={() => setDialog({ kind: 'form' })}>
          新建摄像头
        </Button>
      </div>

      {off && (
        <div
          role="status"
          data-testid="camera-monitor-off-notice"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <span>学校设置里的"监控"开关是关的,老师和校领导看不到画面。</span>
          <Link
            to="/admin/settings"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            去学校设置打开
          </Link>
        </div>
      )}

      {publicHosts.length > 0 && (
        <div
          role="alert"
          data-testid="camera-public-host-warning"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">以下摄像头地址不在校园内网,已拒绝拉流:</p>
          <ul className="mt-1 list-inside list-disc break-all">
            {publicHosts.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {off ? (
        <EmptyState title={'打开"监控"开关后,这里才能添加和管理摄像头'} />
      ) : list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState
          title={list.error instanceof ApiError ? list.error.message : '加载失败,请重试'}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="还没有登记摄像头"
          description={'点右上角"新建摄像头",填入校园内网里的 RTSP 地址'}
        />
      ) : (
        <div data-testid="camera-list" className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                {['名称', '班级 / 公共区域', '位置', '状态', '启用', '操作'].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className={cn('border-t', !c.enabled && 'text-muted-foreground')}>
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.class_name ?? '公共区域'}</td>
                  <td className="px-3 py-2">{c.location}</td>
                  <td className="px-3 py-2">
                    <StatusCell camera={c} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`启用 ${c.name}`}
                      checked={c.enabled}
                      disabled={togglingId !== null}
                      onChange={() => void toggle(c)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'test', camera: c })}
                      >
                        测试连接
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: 'form', camera: c })}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setDeleteError('')
                          setDialog({ kind: 'delete', camera: c })
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'form' && (
        <CameraForm camera={dialog.camera} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'test' && (
        <CameraTestDialog camera={dialog.camera} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <Modal open onClose={() => setDialog(null)} title="删除摄像头" className="max-w-md">
          <p className="text-sm">{`删除后 ${dialog.camera.name} 的画面立即不可看,登记信息不保留。`}</p>
          {deleteError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              确认删除
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
