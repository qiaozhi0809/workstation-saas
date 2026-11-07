import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { CameraPlayer } from '@/shared/components/camera/CameraPlayer'
import { LiveWatermark } from '@/shared/components/camera/LiveWatermark'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import type { CameraBrief, ClassCameras } from '@/shared/types/camera'

/** 任课老师的时段开始 / 结束半分钟内能反映到缩略条上 */
const REFETCH_MS = 30_000

export interface CameraStripProps {
  classId: string
  schoolName: string
  viewerName: string
  timeZone: string
  /** 收起(用户点"收起",或任一路播放器收到"本节课已结束") */
  onClose(): void
  /** 全屏看摄像头时为 true:页面据此暂停空闲动画 */
  onFullscreenChange(active: boolean): void
}

const periodText = (d: ClassCameras | undefined) =>
  d?.reason === 'period' && d.period
    ? `第 ${d.period.no} 节 · ${d.period.subject} · 到 ${d.period.ends_at}`
    : null

/**
 * 进全屏前把缩略画面的当前帧截下来(片段同源,不会污染 canvas);还没出画面 / 截不到就返回 null,用文字占位。
 * 用 JPEG dataURL 而不是留着 <canvas>:播放器马上要卸载,留一张图最省事(L218 ④)
 */
function snapshot(video: HTMLVideoElement | null | undefined): string | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}

/**
 * 舞台下方的本班摄像头缩略条:只在展开时挂载,收起 = 卸载(播放器自己 destroy)。
 * 缩略 120px 高、横向滚动;点缩略进全屏弹层(铺满 + 水印)。
 */
export default function CameraStrip({
  classId,
  schoolName,
  viewerName,
  timeZone,
  onClose,
  onFullscreenChange,
}: CameraStripProps) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['cameras', 'class', classId],
    queryFn: () => camerasApi.classCameras(classId),
    refetchInterval: REFETCH_MS,
  })
  const [full, setFull] = useState<CameraBrief | null>(null)
  // 全屏期间缩略位置显示的最后一帧(按摄像头 id);进全屏那一刻从各缩略的 <video> 截下来
  const [frames, setFrames] = useState<Record<string, string>>({})
  const tilesRef = useRef(new Map<string, HTMLDivElement>())
  const openFull = (c: CameraBrief, list: CameraBrief[]) => {
    const next: Record<string, string> = {}
    for (const cam of list) {
      const url = snapshot(tilesRef.current.get(cam.id)?.querySelector('video'))
      if (url) next[cam.id] = url
    }
    setFrames(next)
    setFull(c)
  }
  const closeFull = () => {
    setFull(null)
    setFrames({})
  }
  const fullscreenRef = useRef(onFullscreenChange)
  fullscreenRef.current = onFullscreenChange
  useEffect(() => {
    if (!full) return
    fullscreenRef.current(true)
    return () => fullscreenRef.current(false)
  }, [full])
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // 模式条上点切换时页面已先收起本条;浏览器前进 / 后退改 ?mode= 不经过那里,这里自己看着地址栏收起(L218 ①)。
  // 别的参数(?student= / ?tab=)变化不算切模式
  const [params] = useSearchParams()
  const mode = params.get('mode')
  const modeRef = useRef(mode)
  useEffect(() => {
    if (mode === modeRef.current) return
    modeRef.current = mode
    onCloseRef.current()
  }, [mode])

  // 多路同时 403 只提示一次;收起后本组件卸载,其余播放器随之销毁
  const endedRef = useRef(false)
  const finish = (text: string) => {
    if (endedRef.current) return
    endedRef.current = true
    toast(text)
    void qc.invalidateQueries({ queryKey: ['classroom', classId] })
    onClose()
    // 把这个班的列表缓存丢掉,下次展开从头加载,不会被缓存里的空列表/403 立刻再收起
    qc.removeQueries({ queryKey: ['cameras', 'class', classId] })
  }
  const ended = () => finish('本节课已结束')
  const finishRef = useRef(finish)
  finishRef.current = finish
  const period = periodText(q.data)
  const cameras = q.data?.cameras ?? []
  // 下课后后端返回 200 + 空列表(403 只在失去班级读权限时才有)。曾经看到过机位、刷新后变空要分原因(L218 ③):
  // 接口没有单独的"停用 / 结束"字段——任课老师(上次 reason 'period')的时段还在(period 仍非空,后端仍放行)
  // 却没机位了 → 管理员课中停用了全部摄像头;时段没了(占位 reason 'homeroom'、period null)→ 本节课已结束;
  // 班主任 / 管理员的观看资格不随节次结束,变空只能是停用。首次加载就是空的照常显示提示
  const hadReasonRef = useRef<ClassCameras['reason'] | null>(null)
  if (q.data && cameras.length > 0) hadReasonRef.current = q.data.reason
  const emptied = !!q.data && cameras.length === 0 && hadReasonRef.current !== null
  const disabled =
    emptied && (hadReasonRef.current !== 'period' || (q.data?.period ?? null) !== null)
  const forbidden = q.error instanceof ApiError && q.error.status === 403
  useEffect(() => {
    if (forbidden) finishRef.current('本节课已结束')
    else if (emptied) finishRef.current(disabled ? '摄像头已被管理员停用' : '本节课已结束')
  }, [forbidden, emptied, disabled])

  let body: ReactNode
  if (q.isPending) body = <p className="px-1 text-sm text-muted-foreground">加载中…</p>
  else if (q.isError && !q.data)
    body = (
      <p role="alert" className="px-1 text-sm text-destructive">
        {q.error instanceof Error && q.error.message ? q.error.message : '教室画面加载失败'}
      </p>
    )
  else if (cameras.length === 0)
    body = <p className="px-1 text-sm text-muted-foreground">现在看不到本班的摄像头</p>
  // 刷新失败(非 403)时继续显示上一次的列表;全屏期间缩略不挂播放器,同一路只拉一份
  else
    body = (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cameras.map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              if (el) tilesRef.current.set(c.id, el)
              else tilesRef.current.delete(c.id)
            }}
            className="relative h-[120px] w-[213px] shrink-0 overflow-hidden rounded-lg border bg-muted"
          >
            {full ? (
              // 全屏期间不挂播放器:截下的最后一帧垫底(截不到就只有文字),上面写明状态
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {frames[c.id] && (
                  <img
                    src={frames[c.id]}
                    alt={`${c.name} 最后一帧`}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
                <span className="relative rounded bg-background/80 px-1.5 py-0.5">
                  {full.id === c.id ? '正在全屏' : '全屏中暂停'}
                </span>
              </div>
            ) : (
              <CameraPlayer cameraId={c.id} title={c.name} onEnded={ended} />
            )}
            <button
              type="button"
              aria-label={`全屏查看 ${c.name}`}
              title="全屏查看"
              className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openFull(c, cameras)}
            />
            <span className="pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-background/80 px-1.5 py-0.5 text-xs text-foreground">
              {c.name}
            </span>
          </div>
        ))}
      </div>
    )

  return (
    <section
      data-testid="camera-strip"
      aria-label="教室画面"
      className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <h3 className="text-sm font-medium">教室画面</h3>
        {period && (
          <span data-testid="camera-strip-period" className="text-xs text-muted-foreground">
            {period}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          收起
        </Button>
      </div>
      {body}
      {/* 弹层宽度按视口高度反推(16:9 画面 + 标题不超过一屏),1024×768 的投影上也不用滚动 */}
      {full && (
        <Modal
          open
          onClose={closeFull}
          title={full.name}
          description={period ?? undefined}
          className="sm:max-w-[min(96vw,calc((100dvh_-_9rem)*16/9),1280px)]"
        >
          <div
            data-testid="camera-fullscreen"
            className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted"
          >
            <CameraPlayer cameraId={full.id} title={full.name} onEnded={ended} />
            <LiveWatermark schoolName={schoolName} viewerName={viewerName} timeZone={timeZone} />
          </div>
        </Modal>
      )}
    </section>
  )
}
