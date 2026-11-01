import { M } from '../layout'
import type { HairStyle } from './identity'
import { INK, mix } from './palette'

// 所有部件以头心为原点 (0,0);身体向下延伸到 M.FIGURE_BOTTOM 以内
const R = M.HEAD_R
const edge = { stroke: INK.outline, strokeWidth: 2, strokeLinejoin: 'round' as const }
const thin = { ...edge, strokeWidth: 1.5 }
const HAIR_HI = mix(INK.hair, '#ffffff', 0.22)
const BUZZ = mix(INK.hair, INK.skin, 0.38)
const line = (stroke: string, w: number) => ({ fill: 'none', stroke, strokeWidth: w, strokeLinecap: 'round' as const })

// 带白边的一截胳膊(袖子 + 手)
export function Limb({ x1, y1, x2, y2, color, hand = 5 }: {
  x1: number; y1: number; x2: number; y2: number; color: string; hand?: number
}) {
  const d = `M ${x1} ${y1} L ${x2} ${y2}`
  return (
    <>
      <path d={d} {...line(INK.outline, 12.5)} />
      <path d={d} {...line(color, 8.5)} />
      <circle cx={x2} cy={y2} r={hand} fill={INK.skin} {...thin} />
    </>
  )
}

const Ears = () => (
  <>
    <ellipse cx={-R + 0.5} cy={2} rx={3.4} ry={4.6} fill={INK.skin} {...thin} />
    <ellipse cx={R - 0.5} cy={2} rx={3.4} ry={4.6} fill={INK.skin} {...thin} />
  </>
)

function spikyPath(base: number, amp: number) {
  const n = 14
  const pts = Array.from({ length: n + 1 }, (_, j) => {
    const t = Math.PI + (j * Math.PI) / n
    const r = j % 2 ? base + 1.5 + amp * Math.sin((j / n) * Math.PI) : base
    return `${(Math.cos(t) * r).toFixed(1)} ${(Math.sin(t) * r).toFixed(1)}`
  })
  return `M ${pts.join(' L ')} A ${base} ${base} 0 0 1 ${-base} 0 Z`
}

const Braid = ({ x, y }: { x: number; y: number }) => (
  <g>
    {[0, 1, 2].map((i) => (
      <ellipse key={i} cx={x + i * 1.6} cy={y + i * 7} rx={4.3} ry={4.7} fill={INK.hair} {...thin} />
    ))}
    <path d={`M ${x + 1.5} ${y + 19} L ${x + 4.2} ${y + 26} L ${x + 6.6} ${y + 19} Z`} fill={INK.hair} {...thin} />
    <circle cx={x + 4} cy={y + 18.5} r={2.4} fill={INK.cheek} {...thin} />
  </g>
)

const Beanie = ({ color, top }: { color: string; top: number }) => {
  const band = mix(color, '#000000', 0.14)
  return (
    <g>
      <path d={`M -18 ${top + 3} A 18 18 0 0 1 18 ${top + 3} Z`} fill={mix(color, '#ffffff', 0.28)} {...edge} />
      <rect x={-19.5} y={top} width={39} height={7.5} rx={3.75} fill={band} {...edge} />
      {[-13, -6.5, 0, 6.5, 13].map((x) => (
        <path key={x} d={`M ${x} ${top + 2} L ${x} ${top + 5.5}`} {...line(INK.outline, 1)} opacity={0.5} />
      ))}
      <circle cx={0} cy={top - 15} r={5} fill={INK.outline} stroke={band} strokeWidth={1.2} />
    </g>
  )
}

// 背影:只见发型
export function HairBack({ style, color }: { style: HairStyle; color: string }) {
  const head = (fill: string = INK.hair) => <circle r={R} fill={fill} {...edge} />
  switch (style) {
    case 'braid':
      return (
        <>
          <Ears />{head()}
          <path d="M 0 -17 L 0 -4" {...line(HAIR_HI, 1.5)} />
          <path d="M -11 -10 Q 1 -2 9 8 M 9 -12 Q 9 0 11 6" {...line(HAIR_HI, 1.1)} opacity={0.7} />
          <Braid x={10} y={12} />
        </>
      )
    case 'bob':
      return (
        <>
          <path d="M -18 6 A 19 19 0 1 1 18 6 L 19.5 12.5 Q 0 16.5 -19.5 12.5 Z" fill={INK.hair} {...edge} />
          <path d="M -11 -11 Q -3 -16 6 -15" {...line(HAIR_HI, 1.6)} />
          <path d="M -6 13 L -6 9 M 0 14 L 0 10 M 6 13 L 6 9" {...line(HAIR_HI, 1)} opacity={0.6} />
        </>
      )
    case 'pony':
      return (
        <>
          <Ears />{head()}
          <path d="M -12 -6 Q -5 -9 -2 -11 M 12 -6 Q 5 -9 2 -11" {...line(HAIR_HI, 1.1)} opacity={0.7} />
          <path d="M -4 -10 C -9 2 -6 16 1 27 C 8 15 8 2 4 -10 Z" fill={INK.hair} {...thin} />
          <path d="M 0 -4 Q -1 8 1 20" {...line(HAIR_HI, 1.1)} opacity={0.7} />
          <ellipse cx={0} cy={-11} rx={5.5} ry={3} fill={INK.cheek} {...thin} />
        </>
      )
    case 'spiky':
      return (
        <>
          <Ears />
          <path d={spikyPath(R, 4)} fill={INK.hair} {...edge} />
          <path d="M -6 -9 L -2 -4 M 5 -10 L 2 -5" {...line(HAIR_HI, 1.2)} opacity={0.7} />
        </>
      )
    case 'buzz':
      return (
        <>
          <Ears />{head(BUZZ)}
          <path d="M -9 12 Q 0 15.5 9 12" {...line(INK.hair, 1.4)} opacity={0.55} />
          <path d="M 1 -8 q 3 1 2 4 q -2 2 -4 0" {...line(INK.hair, 0.9)} opacity={0.5} />
        </>
      )
    case 'side':
      return (
        <>
          <Ears />
          <path d="M 3 -15 Q 7 -25 13 -20 Q 9 -19 9 -14 Z" fill={INK.hair} {...thin} />
          {head()}
          <path d="M -6 -16.5 Q -8 -10 -13.5 -6" {...line(HAIR_HI, 1.6)} />
          <path d="M -2 -12 Q 6 -6 12 -6" {...line(HAIR_HI, 1)} opacity={0.6} />
        </>
      )
    case 'beanie':
      return (
        <>
          <Ears />{head()}
          <Beanie color={color} top={-4} />
        </>
      )
  }
}

// 正脸:脸、两个圆点眼、短弧线嘴、两颊红点
export function Face() {
  return (
    <>
      <circle r={R} fill={INK.skin} {...edge} />
      <circle cx={-6} cy={3} r={1.9} fill={INK.hair} />
      <circle cx={6} cy={3} r={1.9} fill={INK.hair} />
      <path d="M -3.8 9 Q 0 12 3.8 9" {...line(INK.hair, 1.6)} />
      <circle cx={-10.5} cy={8} r={2.8} fill={INK.cheek} opacity={0.75} />
      <circle cx={10.5} cy={8} r={2.8} fill={INK.cheek} opacity={0.75} />
    </>
  )
}

// 正脸时画在脸后面的头发(长发、马尾、刺头轮廓)
export function HairBehind({ style }: { style: HairStyle }) {
  switch (style) {
    case 'bob':
      return <path d="M -19 2 A 19.5 19.5 0 1 1 19 2 L 20 13 Q 15 15.5 11 12 L -11 12 Q -15 15.5 -20 13 Z" fill={INK.hair} {...edge} />
    case 'pony':
      return <path d="M 6 -15 C 22 -16 27 4 18 19 C 16 8 14 0 8 -6 Z" fill={INK.hair} {...edge} />
    case 'spiky':
      return <path d={spikyPath(R, 4)} fill={INK.hair} {...edge} />
    case 'side':
      return <path d="M 3 -15 Q 7 -25 13 -20 Q 9 -19 9 -14 Z" fill={INK.hair} {...thin} />
    default:
      return null
  }
}

// 正脸时盖在脸上的刘海 / 帽子;有 HairBehind 轮廓的发型刘海不描边,免得像发箍
export function HairFront({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case 'braid':
      return (
        <>
          <path d="M -16.9 -1 A 17 17 0 0 1 16.9 -1 Q 10 -11 0 -8 Q -9 -11 -16.9 -1 Z" fill={INK.hair} {...edge} />
          <Braid x={12} y={8} />
        </>
      )
    case 'bob':
      return <path d="M -17.9 -1.5 A 18 18 0 0 1 17.9 -1.5 L 15 -6 L -15 -6 Z" fill={INK.hair} />
    case 'pony':
      return (
        <>
          <path d="M -16.9 -1 A 17 17 0 0 1 16.9 -1 Q 12 -12 -2 -9 Q -10 -8 -16.9 -1 Z" fill={INK.hair} {...edge} />
          <circle cx={13} cy={-13} r={3.2} fill={INK.cheek} {...thin} />
        </>
      )
    case 'spiky':
      return <path d="M -17.9 -1 A 18 18 0 0 1 17.9 -1 L 12 -6 L 9 -3 L 5 -8 L 1 -4 L -3 -8 L -7 -4 L -11 -7 L -14 -3 Z" fill={INK.hair} />
    case 'buzz':
      return <path d="M -16.6 -4 A 17 17 0 0 1 16.6 -4 Q 0 -11 -16.6 -4 Z" fill={BUZZ} {...edge} />
    case 'side':
      return <path d="M -16.9 -1 A 17 17 0 0 1 16.9 -1 Q 15 -9 6 -9 Q -6 -8 -12 -2 Q -15 -3 -16.9 -1 Z" fill={INK.hair} {...edge} />
    case 'beanie':
      return (
        <>
          <path d="M -16 1 Q -14 -4 -11 -6 L -14 -3 Z M 16 1 Q 14 -4 11 -6 L 14 -3 Z" fill={INK.hair} {...thin} />
          <Beanie color={color} top={-8} />
        </>
      )
  }
}

const BODY = 'M -29 50 L -29 31 Q -29 13 -11 12 L 11 12 Q 29 13 29 31 L 29 50 Z'

// 卫衣背面:衣身 + 搭在背上的帽子 + 帽沿
export function HoodieBack({ color }: { color: string }) {
  return (
    <>
      <path d={BODY} fill={color} {...edge} />
      <path d="M -15 11 Q -17 31 0 34 Q 17 31 15 11 Z" fill={mix(color, '#000000', 0.12)} {...thin} />
      <path d="M -11.5 12 Q -12 24 0 26 Q 12 24 11.5 12" {...line(mix(color, '#ffffff', 0.38), 2.2)} />
    </>
  )
}

// 卫衣正面:衣身 + 帽沿领口 + 抽绳 + 口袋
export function HoodieFront({ color }: { color: string }) {
  return (
    <>
      <path d={BODY} fill={color} {...edge} />
      <path d="M -14 11 Q 0 25 14 11 L 10.5 10 Q 0 19 -10.5 10 Z" fill={mix(color, '#ffffff', 0.38)} {...thin} />
      <path d="M -4 18 L -5 29 M 4 18 L 5 29" {...line(INK.outline, 1.6)} />
      <path d="M -13 50 L -10 38 Q 0 36 10 38 L 13 50" fill={mix(color, '#000000', 0.1)} {...thin} />
    </>
  )
}
