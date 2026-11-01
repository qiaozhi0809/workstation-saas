export interface View { s: number; x: number; y: number }
export interface Size { w: number; h: number }

export const MIN_S = 0.3, MAX_S = 2.5, FIT_MAX_S = 1.25
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// 整间教室放进舞台并居中(放大不超过 1.25)
export function fitView(content: Size, stage: Size): View {
  const s = clamp(Math.min(stage.w / (content.w || 1), stage.h / (content.h || 1)), MIN_S, FIT_MAX_S)
  return { s, x: (stage.w - content.w * s) / 2, y: (stage.h - content.h * s) / 2 }
}

// 以舞台坐标 point 为中心缩放:该点在缩放前后的屏幕位置不变
export function zoomAt(view: View, factor: number, point: { x: number; y: number }): View {
  const s = clamp(view.s * factor, MIN_S, MAX_S), k = s / view.s
  return { s, x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k }
}

// 两轴各至少留 min(keep, 缩放后内容尺寸) 像素在舞台内;舞台太小时下界优先
export function clampView(view: View, content: Size, stage: Size, keep = 140): View {
  const axis = (p: number, len: number, room: number) => {
    const k = Math.min(keep, len)
    return Math.max(k - len, Math.min(room - k, p))
  }
  return { s: view.s, x: axis(view.x, content.w * view.s, stage.w), y: axis(view.y, content.h * view.s, stage.h) }
}

export const wheelZoomFactor = (deltaY: number) => Math.exp(-deltaY * 0.0018)
