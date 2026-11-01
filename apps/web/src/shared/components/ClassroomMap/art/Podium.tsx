import type { Rect } from '../layout'
import type { TeacherAction } from '../types'
import { GROUP_COLORS, INK, ROOM, SHADOW } from './palette'
import { WOOD, WOOD_DARK, clip, edge, shade, thin, tint } from './kit'
import TeacherFigure from './TeacherFigure'

interface Props {
  rect: Rect
  teacher: { figure: 'female' | 'male'; label: string }
  action: TeacherAction
  pointAt?: { x: number; y: number }
}

const LECTERN_W = 148, TOP_D = 40, FACE = 12, STAND_Y = 62

// 讲台平台 → 讲桌(桌面道具都画在桌面内,不越过后沿)→ 老师。
// 老师躯干在 y=0 平切、正好落在桌面后沿,先画讲桌不会遮住身体,而教鞭能压在桌面上指向学生。
export default function Podium({ rect, teacher, action, pointAt }: Props) {
  const cx = rect.x + rect.w / 2, oy = rect.y + STAND_Y, lx = cx - LECTERN_W / 2
  const plate = clip(teacher.label, 50, 11)
  return (
    <g className="cr-podium">
      <g filter={SHADOW}>
        <rect x={rect.x} y={rect.y + 6} width={rect.w} height={rect.h - 18} rx={6} fill={tint(WOOD, 0.35)} {...edge} />
        <rect x={rect.x + 2} y={rect.y + rect.h - 20} width={rect.w - 4} height={10} rx={3} fill={WOOD} />
      </g>
      <g filter={SHADOW}>
        <rect x={lx} y={oy} width={LECTERN_W} height={TOP_D + FACE} rx={4} fill={WOOD_DARK} {...edge} />
        <rect x={lx + 1} y={oy + 1} width={LECTERN_W - 2} height={TOP_D} rx={3} fill={tint(WOOD, 0.2)} />
      </g>
      <path d={`M ${lx + 12} ${oy + TOP_D + 6} L ${lx + LECTERN_W - 12} ${oy + TOP_D + 6}`} stroke={shade(WOOD_DARK, 0.15)} strokeWidth={1.2} />
      <g className="cr-laptop" transform={`translate(${cx - 66} ${oy + 5})`}>
        <rect x={-2} y={23} width={50} height={6} rx={2} fill={shade(ROOM.trim, 0.2)} {...thin} />
        <rect width={46} height={25} rx={3} fill={ROOM.trim} {...edge} />
        <circle cx={23} cy={12} r={3.5} fill={ROOM.desk} />
      </g>
      <g className="cr-nameplate" transform={`translate(${cx - 12} ${oy + 12})`}>
        <path d="M 2 0 L 54 0 L 58 22 L -2 22 Z" fill={ROOM.desk} {...edge} />
        <rect x={2} y={18} width={52} height={3} fill={GROUP_COLORS[0]} />
        <text x={28} y={14} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK.hair}>{plate}</text>
      </g>
      {action !== 'sip' && (
        <g className="cr-mug" transform={`translate(${cx + 52} ${oy + 12})`}>
          <path d="M 12 4 q 6 0 6 5 q 0 5 -6 5" fill="none" stroke={INK.outline} strokeWidth={5} />
          <path d="M 12 4 q 6 0 6 5 q 0 5 -6 5" fill="none" stroke={ROOM.gold} strokeWidth={2.6} />
          <rect width={13} height={16} rx={2.5} fill={ROOM.gold} {...thin} />
          <ellipse cx={6.5} cy={2} rx={5} ry={1.5} fill={shade(ROOM.gold, 0.35)} />
        </g>
      )}
      <TeacherFigure x={cx} y={oy} figure={teacher.figure} action={action} pointAt={pointAt} />
    </g>
  )
}
