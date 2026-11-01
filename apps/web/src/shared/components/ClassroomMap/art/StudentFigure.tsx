import { hairStyleOf, type Gender, type Pose } from './identity'
import { INK, ROOM, SHADOW } from './palette'
import { Face, HairBack, HairBehind, HairFront, HoodieBack, HoodieFront, Limb } from './parts'

// 接口约定由本文件导出(brief);纯函数实现在 identity.ts
// eslint-disable-next-line react-refresh/only-export-components
export { genderOf, hairStyleOf } from './identity'
export type { HairStyle, Pose } from './identity'

interface Props {
  x: number; y: number; gender: Gender; seed: string; color: string; pose: Pose; scale?: number
}

// 六角星
function star(cx: number, cy: number, ro: number, ri: number) {
  const pts = Array.from({ length: 12 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 6, r = i % 2 ? ri : ro
    return `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`
  })
  return `M ${pts.join(' L ')} Z`
}
const BURST = Array.from({ length: 6 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 3
  return star(Math.cos(a) * 29, Math.sin(a) * 29, 5.5, 2.8)
}).join(' ')

const Zz = ({ cx, cy, r, size, cls }: { cx: number; cy: number; r: number; size: number; cls: string }) => (
  <g className={`cr-z ${cls}`}>
    <circle cx={cx} cy={cy} r={r} fill={INK.outline} stroke={ROOM.trim} strokeWidth={1.2} />
    <text x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={700} fill={INK.hair}>z</text>
  </g>
)

// 一侧胳膊:外层定位到肩膀,内层 .cr-arm-r 供 CSS 绕肩旋转;mirror 时整体水平翻转成另一侧
function Arm({ sx, sy, dx, dy, color, mirror }: {
  sx: number; sy: number; dx: number; dy: number; color: string; mirror?: boolean
}) {
  const arm = (
    <g transform={`translate(${sx} ${sy})`}>
      <g className="cr-arm-r"><Limb x1={0} y1={0} x2={dx} y2={dy} color={color} /></g>
    </g>
  )
  return mirror ? <g transform="scale(-1 1)">{arm}</g> : arm
}

export default function StudentFigure({ x, y, gender, seed, color, pose, scale = 1 }: Props) {
  const hair = hairStyleOf(gender, seed)
  const front = pose === 'turn' || pose === 'stand'
  const transform = scale === 1 ? `translate(${x} ${y})` : `translate(${x} ${y}) scale(${scale})`
  const arms =
    pose === 'raise' ? <Arm sx={19} sy={13} dx={5} dy={-46} color={color} />
    : pose === 'stretch' ? <><Arm sx={16} sy={13} dx={11} dy={-42} color={color} /><Arm sx={16} sy={13} dx={11} dy={-42} color={color} mirror /></>
    : pose === 'stand' ? <><Arm sx={23} sy={16} dx={5} dy={30} color={color} /><Arm sx={23} sy={16} dx={5} dy={30} color={color} mirror /></>
    : null

  return (
    <g className="cr-stu cr-anim" data-pose={pose} data-hair={hair} transform={transform} filter={SHADOW}>
      <g className="cr-pose">
        <g className="cr-body">
          {front ? <g className="cr-front"><HoodieFront color={color} /></g> : <HoodieBack color={color} />}
        </g>
        {arms && <g className="cr-arm">{arms}</g>}
        <g className="cr-head">
          {front ? (
            <g className="cr-front">
              <HairBehind style={hair} />
              <g className="cr-face"><Face /></g>
              <g className="cr-hair"><HairFront style={hair} color={color} /></g>
            </g>
          ) : (
            <g className="cr-hair"><HairBack style={hair} color={color} /></g>
          )}
        </g>
        {pose === 'doze' && (
          <g className="cr-zz">
            <Zz cx={17} cy={-21} r={6} size={8} cls="cr-z1" />
            <Zz cx={27} cy={-33} r={7.5} size={10.5} cls="cr-z2" />
          </g>
        )}
        {pose === 'stand' && (
          <g className="cr-burst">
            <circle r={29} fill="none" stroke={ROOM.gold} strokeWidth={1.5} strokeDasharray="2 5" opacity={0.7} />
            <path d={BURST} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1.2} strokeLinejoin="round" />
          </g>
        )}
      </g>
    </g>
  )
}
