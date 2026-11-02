export interface View { s: number; x: number; y: number }
export interface Size { w: number; h: number }

export const MAX_S = 2.5, FIT_MIN_S = 0.1, FIT_MAX_S = 1.25
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// 适应视图("适应"比例,也是手动缩小的下限;放大不超过 1.25,缩小不低于 0.1)
// safeW:比例不超过"安全区宽度放得下"(加宽场景时两翼可被裁掉),默认整幅内容宽
// core:只要求它(前墙到最后一排)纵向完整;不传时 = 整幅高度,与只按高度适应逐值相同
//   s = min(stage.w / safeW, max(stage.h / H, min(stage.w / W, stage.h / core.h)))
//   即高度适应已铺满宽度时不变;铺不满时放大到"铺满宽度"与"核心刚好放下"两者较小者
// 横向居中;纵向居中,若居中会裁到核心则夹到核心完整可见的范围内
export function fitView(content: Size, stage: Size, safeW = content.w, core?: { y: number; h: number }): View {
  const cy = core?.y ?? 0, ch = core?.h ?? content.h
  const byCore = Math.min(stage.w / (content.w || 1), stage.h / (ch || 1))
  const s = clamp(Math.min(stage.w / (safeW || 1), Math.max(stage.h / (content.h || 1), byCore)), FIT_MIN_S, FIT_MAX_S)
  const centred = (stage.h - content.h * s) / 2
  const lo = -cy * s, hi = stage.h - (cy + ch) * s
  // 核心放不下(比例被夹到下限)时让核心居中
  const y = lo <= hi ? clamp(centred, lo, hi) : (lo + hi) / 2
  return { s, x: (stage.w - content.w * s) / 2, y }
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
// core 与 fitView 相同,保证判断用的就是舞台上实际的适应视图
export function rectFullyShownInFit(
  content: Size, stage: Size, safeW: number, r: { x: number; y: number; w: number; h: number },
  core?: { y: number; h: number },
): boolean {
  if (stage.w <= 0 || stage.h <= 0) return false
  const v = fitView(content, stage, safeW, core), e = 0.5
  return v.x + r.x * v.s >= -e && v.y + r.y * v.s >= -e
    && v.x + (r.x + r.w) * v.s <= stage.w + e && v.y + (r.y + r.h) * v.s <= stage.h + e
}
