import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import Modal from '@/shared/components/overlay/Modal'
import { Button } from '@/shared/components/ui/button'
import type { CameraOut, StreamProbe } from '@/shared/types/camera'

const CODEC_LABEL: Record<string, string> = {
  h264: 'H.264',
  hevc: 'H.265(HEVC)',
  h265: 'H.265(HEVC)',
  mpeg4: 'MPEG-4',
  mjpeg: 'MJPEG',
}
const codecLabel = (codec: string) => CODEC_LABEL[codec.toLowerCase()] ?? codec.toUpperCase()

/** "编码 H.264 · 1920×1080 · 25 fps":哪项为空就省略哪项 */
function probeLine(probe: StreamProbe): string {
  const parts: string[] = []
  if (probe.video_codec) parts.push(`编码 ${codecLabel(probe.video_codec)}`)
  if (probe.width && probe.height) parts.push(`${probe.width}×${probe.height}`)
  if (probe.fps) parts.push(`${Math.round(probe.fps)} fps`)
  return parts.join(' · ')
}

const FALLBACK_HINT =
  '这路视频不是 H.264,浏览器放不出来;请在摄像头里改成 H.264,或编辑这路摄像头勾选"转码"。'

/** 测试连接:打开即请求一次(后端最多等 10 秒),显示预览图 / 流信息 / 错误 */
export default function CameraTestDialog({
  camera,
  onClose,
}: {
  camera: CameraOut
  onClose(): void
}) {
  // 测试是带审计的 POST:用 mutation,只在打开时发一次、点"重试"再发,不受 ['cameras'] 失效影响
  const test = useMutation({ mutationFn: () => camerasApi.test(camera.id) })
  const { mutate } = test
  useEffect(() => {
    mutate()
  }, [mutate])
  const data = test.data
  const probe = data?.probe ?? null
  const line = probe ? probeLine(probe) : ''

  return (
    <Modal open onClose={onClose} title={`测试连接:${camera.name}`} className="max-w-lg">
      <div data-testid="camera-test-dialog" className="space-y-3 text-sm">
        {test.isPending && <LoadingState label="正在连接摄像头,最多等 10 秒…" />}
        {test.isError && (
          <p role="alert" className="text-destructive">
            {test.error instanceof ApiError ? test.error.message : '测试失败,请重试'}
          </p>
        )}
        {data &&
          (data.ok ? (
            <p className="text-success">{data.message}</p>
          ) : (
            <p role="alert" className="text-destructive">
              {data.message}
            </p>
          ))}
        {data?.preview_jpeg_base64 && (
          <img
            alt="摄像头预览"
            src={`data:image/jpeg;base64,${data.preview_jpeg_base64}`}
            className="w-full rounded-md border bg-muted"
          />
        )}
        {line && <p className="text-muted-foreground">{line}</p>}
        {probe && !probe.browser_playable && (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3"
          >
            {data?.ok && <p className="font-medium">测试成功,但浏览器放不出这路画面</p>}
            <p>{probe.hint ?? FALLBACK_HINT}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={test.isPending}
            onClick={() => mutate()}
          >
            重试
          </Button>
          <Button type="button" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
