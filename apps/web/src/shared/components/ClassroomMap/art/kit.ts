import { INK, ROOM, mix } from './palette'

// 场景件共用的描边与派生色(全部由 palette 混出,不用渐变)
export const edge = { stroke: INK.outline, strokeWidth: 2, strokeLinejoin: 'round' as const }
export const thin = { ...edge, strokeWidth: 1.5 }
export const WOOD = mix(mix(ROOM.deskEdge, INK.hair, 0.3), ROOM.gold, 0.28)
export const WOOD_DARK = mix(WOOD, INK.hair, 0.3)
export const MUTED = mix(INK.hair, ROOM.floor, 0.45)
export const tint = (c: string, t = 0.6) => mix(c, '#ffffff', t)
export const shade = (c: string, t = 0.15) => mix(c, '#000000', t)

// 估算文字宽度(中日韩字符按 1em,其余 0.58em),超出时截断加省略号
export function clip(text: string, maxW: number, fs: number): string {
  const cw = (ch: string) => (/[⺀-￿]/.test(ch) ? fs : fs * 0.58)
  let w = 0
  for (let i = 0; i < text.length; i++) {
    w += cw(text[i])
    if (w > maxW) return text.slice(0, Math.max(0, i - 1)) + '…'
  }
  return text
}
