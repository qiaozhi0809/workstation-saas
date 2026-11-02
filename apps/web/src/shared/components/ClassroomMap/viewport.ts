export interface View { s: number; x: number; y: number }
export interface Size { w: number; h: number }

export const MAX_S = 2.5, FIT_MIN_S = 0.1, FIT_MAX_S = 1.25
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// 整间教室放进舞台并居中(放大不超过 1.25,缩小不低于 0.1)。这就是"适应"比例,也是手动缩小的下限
// safeW:适应比例只看安全区宽度(加宽场景时两翼可被裁掉),默认整幅内容宽
export function fitView(content: Size, stage: Size, safeW = content.w): View {
  const s = clamp(Math.min(stage.w / (safeW || 1), stage.h / (content.h || 1)), FIT_MIN_S, FIT_MAX_S)
  return { s, x: (stage.w - content.w * s) / 2, y: (stage.h - content.h * s) / 2 }
}

// 以舞台坐标 point 为中心缩放:该点在缩放前后的屏幕位置不变。比例夹在 [minS, MAX_S],minS 是当前舞台的适应比例
export function zoomAt(view: View, factor: number, point: { x: number; y: number }, minS: number): View {
  const s = clamp(view.s * factor, minS, MAX_S), k = s / view.s
  return { s, x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k }
}

// 边界夹取(逐轴):缩放后放不满舞台的一轴居中、不可拖;放得满的一轴始终盖满舞台,拖不出边
export function clampView(view: View, content: Size, stage: Size): View {
  const axis = (p: number, len: number, room: number) =>
    len <= room ? (room - len) / 2 : Math.min(0, Math.max(room - len, p))
  return { s: view.s, x: axis(view.x, content.w * view.s, stage.w), y: axis(view.y, content.h * view.s, stage.h) }
}

export const wheelZoomFactor = (deltaY: number) => Math.exp(-deltaY * 0.0018)

// 场景里的矩形在适应(锁定)视图下是否完整落在舞台内;舞台尺寸未知(0)时算看不到
export function rectFullyShownInFit(
  content: Size, stage: Size, safeW: number, r: { x: number; y: number; w: number; h: number },
): boolean {
  if (stage.w <= 0 || stage.h <= 0) return false
  const v = fitView(content, stage, safeW), e = 0.5
  return v.x + r.x * v.s >= -e && v.y + r.y * v.s >= -e
    && v.x + (r.x + r.w) * v.s <= stage.w + e && v.y + (r.y + r.h) * v.s <= stage.h + e
}
