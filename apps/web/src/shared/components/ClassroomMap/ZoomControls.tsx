import { Scan, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'

interface Props {
  canZoomIn: boolean
  canZoomOut: boolean
  onZoomIn(): void
  onZoomOut(): void
  onFit(): void
}

// 舞台右下角的缩放悬浮钮。到限时用 aria-disabled 而不是 disabled:按钮失效时键盘焦点留在原处、不掉到页面顶部
// 按下事件不冒泡到舞台,不会开始平移或拖座位
export default function ZoomControls({ canZoomIn, canZoomOut, onZoomIn, onZoomOut, onFit }: Props) {
  const item = (label: string, Icon: LucideIcon, run: () => void, enabled = true) => (
    <Button variant="ghost" size="icon" className="h-8 w-8 aria-disabled:cursor-default aria-disabled:opacity-50"
      aria-label={label} title={label} aria-disabled={enabled ? undefined : true}
      onClick={() => { if (enabled) run() }}>
      <Icon aria-hidden />
    </Button>
  )
  return (
    <div role="group" aria-label="缩放" data-zoom-controls="" className="absolute bottom-3 right-3 z-10 flex gap-1 rounded-lg border bg-background/90 p-1 shadow-sm"
      onPointerDown={(e) => e.stopPropagation()}>
      {item('缩小', ZoomOut, onZoomOut, canZoomOut)}
      {item('适应', Scan, onFit)}
      {item('放大', ZoomIn, onZoomIn, canZoomIn)}
    </div>
  )
}
