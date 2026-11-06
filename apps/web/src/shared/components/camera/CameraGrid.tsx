import type { CameraBrief } from '@/shared/types/camera'
import { CameraPlayer } from './CameraPlayer'
import { LiveWatermark } from './LiveWatermark'

const COLS = { 1: 'grid-cols-1', 4: 'grid-cols-2', 9: 'grid-cols-3' } as const

/** 等分宫格。每个格子的状态都在自己的 CameraPlayer 里,一路出错/占满不影响其他路。 */
export function CameraGrid({
  cameras,
  size,
  schoolName,
  viewerName,
  timeZone,
}: {
  cameras: CameraBrief[]
  size: 1 | 4 | 9
  schoolName?: string
  viewerName?: string
  timeZone?: string
}) {
  const watermark = schoolName !== undefined && viewerName !== undefined && timeZone !== undefined
  return (
    <div className={`grid h-full w-full gap-2 ${COLS[size]}`}>
      {cameras.slice(0, size).map((c) => (
        <div key={c.id} className="flex min-h-0 flex-col gap-1">
          <div className="truncate text-xs text-muted-foreground">{c.name}</div>
          <div className="relative aspect-video min-h-0 w-full">
            <CameraPlayer cameraId={c.id} title={c.name} />
            {watermark && (
              <LiveWatermark schoolName={schoolName} viewerName={viewerName} timeZone={timeZone} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
