import type { TeacherAction } from '../types'
import { INK, ROOM, SHADOW, TEACHER_COLORS, mix } from './palette'
import { Limb } from './parts'

interface Pt { x: number; y: number }
interface Props { x: number; y: number; figure: 'female' | 'male'; action: TeacherAction; pointAt?: Pt }

// 度,0 = 正右,顺时针为正(SVG y 轴向下)
// eslint-disable-next-line react-refresh/only-export-components
export function pointerAngle(from: Pt, to: Pt): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

// 原点 (0,0) = 躯干底边中点;躯干在 y = 0 处平切,讲桌桌面的后沿应对齐这里
const HY = -76, HR = 20, SY = -44, SX = 26
const edge = { stroke: INK.outline, strokeWidth: 2, strokeLinejoin: 'round' as const }
const thin = { ...edge, strokeWidth: 1.5 }
const SHIRT = ROOM.wall
const TORSO = 'M -31 0 L -31 -32 Q -31 -50 -14 -52 L 14 -52 Q 31 -50 31 -32 L 31 0 Z'

function Female() {
  const c = TEACHER_COLORS.cardigan, dot = mix(c, '#000000', 0.28)
  return {
    back: <path d={`M -23 ${HY} A 23 23 0 0 1 23 ${HY} L 24 -52 Q 18 -47 12 -51 L -12 -51 Q -18 -47 -24 -52 Z`} fill={INK.hair} {...edge} />,
    torso: (
      <>
        <path d={TORSO} fill={SHIRT} {...edge} />
        <path d="M -31 0 L -31 -32 Q -31 -50 -14 -52 L -8 -52 L -3 -30 L -3 0 Z" fill={c} {...thin} />
        <path d="M 31 0 L 31 -32 Q 31 -50 14 -52 L 8 -52 L 3 -30 L 3 0 Z" fill={c} {...thin} />
        {[-22, -12].map((cy) => <circle key={cy} cx={-6.5} cy={cy} r={1.5} fill={dot} />)}
      </>
    ),
    sleeve: c,
    hair: <path d={`M -20.7 ${HY - 3.5} A 21 21 0 0 1 20.7 ${HY - 3.5} Q 10 ${HY - 12} -4 ${HY - 8} Q -14 ${HY - 6} -20.7 ${HY - 3.5} Z`} fill={INK.hair} />,
  }
}

function Male() {
  const v = TEACHER_COLORS.vest, dot = mix(v, '#000000', 0.3)
  return {
    back: (
      <>
        <ellipse cx={-HR} cy={HY + 2} rx={3.8} ry={5} fill={INK.skin} {...thin} />
        <ellipse cx={HR} cy={HY + 2} rx={3.8} ry={5} fill={INK.skin} {...thin} />
      </>
    ),
    torso: (
      <>
        <path d={TORSO} fill={SHIRT} {...edge} />
        <path d="M -2.5 -46 L 2.5 -46 L 3.5 -30 L 0 -22 L -3.5 -30 Z" fill={ROOM.screen} {...thin} />
        <path d="M -25 0 L -25 -40 Q -24 -49 -15 -52 L 0 -26 L 15 -52 Q 24 -49 25 -40 L 25 0 Z" fill={v} {...thin} />
        <path d="M -1 -51 L -10 -52 L -6 -43 Z M 1 -51 L 10 -52 L 6 -43 Z" fill={ROOM.desk} stroke={ROOM.trim} strokeWidth={1} strokeLinejoin="round" />
        {[-18, -9].map((cy) => <circle key={cy} cx={0} cy={cy} r={1.5} fill={dot} />)}
      </>
    ),
    sleeve: SHIRT,
    hair: (
      <>
        <path d={`M -20.6 ${HY - 2} A 20.6 20.6 0 0 1 20.6 ${HY - 2} Q 18 ${HY - 12} 6 ${HY - 12} Q -4 ${HY - 12} -8 ${HY - 8} Q -12 ${HY - 14} -17 ${HY - 10} Q -20 ${HY - 7} -20.6 ${HY - 2} Z`} fill={INK.hair} {...edge} />
        <path d={`M -9 ${HY - 10} Q -6 ${HY - 16} -1 ${HY - 19}`} fill="none" stroke={mix(INK.hair, '#ffffff', 0.22)} strokeWidth={1.4} strokeLinecap="round" />
      </>
    ),
  }
}

const Glasses = () => (
  <g fill="none" stroke={INK.hair} strokeLinecap="round">
    <circle cx={-8} cy={HY + 2} r={6} fill="#ffffff" fillOpacity={0.35} strokeWidth={1.6} />
    <circle cx={8} cy={HY + 2} r={6} fill="#ffffff" fillOpacity={0.35} strokeWidth={1.6} />
    <path d={`M -2 ${HY + 1.5} Q 0 ${HY} 2 ${HY + 1.5} M -14 ${HY + 1} L -19 ${HY - 1} M 14 ${HY + 1} L 19 ${HY - 1}`} strokeWidth={1.4} />
  </g>
)

export default function TeacherFigure({ x, y, figure, action, pointAt }: Props) {
  const look = figure === 'female' ? Female() : Male()
  const angle = action === 'point' ? (pointAt ? pointerAngle({ x, y: y + SY }, pointAt) : 90) : 0
  const side = angle > 90 ? -1 : 1   // 指向画面左侧时换另一只手
  const busy = action === 'point' ? side : action === 'sip' ? 1 : 0
  const idleArm = (s: number) => <Limb x1={s * SX} y1={SY} x2={s * 29} y2={-6} color={look.sleeve} hand={5.5} />

  return (
    <g className="cr-teacher cr-anim" data-figure={figure} data-action={action} transform={`translate(${x} ${y})`} filter={SHADOW}>
      {look.back}
      <rect x={-5.5} y={-60} width={11} height={10} fill={INK.skin} />
      {look.torso}
      {busy !== -1 && idleArm(-1)}
      {busy !== 1 && idleArm(1)}
      <circle cy={HY} r={HR} fill={INK.skin} {...edge} />
      <circle cx={-8} cy={HY + 2} r={1.8} fill={INK.hair} />
      <circle cx={8} cy={HY + 2} r={1.8} fill={INK.hair} />
      <circle cx={-12.5} cy={HY + 11.5} r={2.8} fill={INK.cheek} opacity={0.75} />
      <circle cx={12.5} cy={HY + 11.5} r={2.8} fill={INK.cheek} opacity={0.75} />
      <path d={`M -4.5 ${HY + 11} Q 0 ${HY + 14.5} 4.5 ${HY + 11}`} fill="none" stroke={INK.hair} strokeWidth={1.6} strokeLinecap="round" />
      <Glasses />
      {look.hair}
      {action === 'point' && (
        <g className="cr-pointer" transform={`translate(${side * SX} ${SY}) rotate(${Math.round(angle * 10) / 10})`}>
          <path d="M 27 0 L 80 0" fill="none" stroke={INK.outline} strokeWidth={5} strokeLinecap="round" />
          <path d="M 27 0 L 80 0" fill="none" stroke={INK.hair} strokeWidth={2.6} strokeLinecap="round" />
          <circle cx={80} cy={0} r={3.4} fill={ROOM.gold} {...thin} />
          <Limb x1={0} y1={0} x2={24} y2={0} color={look.sleeve} hand={5.5} />
        </g>
      )}
      {action === 'sip' && (
        <g className="cr-mug-up">
          <Limb x1={SX} y1={SY} x2={31} y2={-28} color={look.sleeve} hand={0} />
          <Limb x1={31} y1={-28} x2={17} y2={-58} color={look.sleeve} hand={0} />
          <path d={`M 21 ${HY + 9} q 6 0 6 5 q 0 5 -6 5`} fill="none" stroke={INK.outline} strokeWidth={5} />
          <path d={`M 21 ${HY + 9} q 6 0 6 5 q 0 5 -6 5`} fill="none" stroke={ROOM.gold} strokeWidth={2.6} />
          <rect x={8} y={HY + 5} width={13} height={14} rx={2.5} fill={ROOM.gold} {...thin} />
          <circle cx={17} cy={-58} r={5.5} fill={INK.skin} {...thin} />
        </g>
      )}
    </g>
  )
}
