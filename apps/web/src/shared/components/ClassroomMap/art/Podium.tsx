import type { Rect } from '../layout'
import type { TeacherAction } from '../types'
import { GROUP_COLORS, INK, ROOM, shadowFilter } from './palette'
import { WOOD, WOOD_DARK, clip, edge, shade, textW, thin, tint } from './kit'
import TeacherFigure from './TeacherFigure'

interface Props {
  rect: Rect
  teacher: { figure: 'female' | 'male'; label: string }
  action: TeacherAction
  pointAt?: { x: number; y: number }
  /** 投影滤镜的 id,透传给讲台与老师;独立 svg(欢迎页形象卡)传自己那份 defs 的 id(L241) */
  shadowId?: string
}

const LECTERN_W = 148,
  TOP_D = 40,
  FACE = 12,
  STAND_Y = 62

// 讲台平台 → 讲桌(桌面道具都画在桌面内,不越过后沿;姓名牌挂在朝向学生的前沿)→ 老师。
// 老师躯干在 y=0 平切、正好落在桌面后沿,先画讲桌不会遮住身体,而教鞭能压在桌面上指向学生。
export default function Podium({ rect, teacher, action, pointAt, shadowId }: Props) {
  const cx = rect.x + rect.w / 2,
    oy = rect.y + STAND_Y,
    lx = cx - LECTERN_W / 2
  const plate = clip(teacher.label, LECTERN_W - 32, 10.5),
    pw = textW(plate, 10.5) + 18
  const shadow = shadowFilter(shadowId)
  return (
    <g className="cr-podium">
      <g filter={shadow}>
        <rect
          x={rect.x}
          y={rect.y + 6}
          width={rect.w}
          height={rect.h - 18}
          rx={6}
          fill={tint(WOOD, 0.35)}
          {...edge}
        />
        <rect
          x={rect.x + 2}
          y={rect.y + rect.h - 20}
          width={rect.w - 4}
          height={10}
          rx={3}
          fill={WOOD}
        />
      </g>
      <g filter={shadow}>
        <rect
          x={lx}
          y={oy}
          width={LECTERN_W}
          height={TOP_D + FACE}
          rx={4}
          fill={WOOD_DARK}
          {...edge}
        />
        <rect
          x={lx + 1}
          y={oy + 1}
          width={LECTERN_W - 2}
          height={TOP_D}
          rx={3}
          fill={tint(WOOD, 0.2)}
        />
      </g>
      <path
        d={`M ${lx + 12} ${oy + TOP_D + 6} L ${lx + LECTERN_W - 12} ${oy + TOP_D + 6}`}
        stroke={shade(WOOD_DARK, 0.15)}
        strokeWidth={1.2}
      />
      <g className="cr-laptop" transform={`translate(${cx - 66} ${oy + 5})`}>
        <rect x={-2} y={23} width={50} height={6} rx={2} fill={shade(ROOM.trim, 0.2)} {...thin} />
        <rect width={46} height={25} rx={3} fill={ROOM.trim} {...edge} />
        <circle cx={23} cy={12} r={3.5} fill={ROOM.desk} />
      </g>
      {plate && (
        <g className="cr-nameplate" transform={`translate(${cx} ${oy + TOP_D - 3})`}>
          <rect x={-pw / 2} width={pw} height={17} rx={3} fill={ROOM.desk} {...edge} />
          <rect x={-pw / 2 + 2} y={13} width={pw - 4} height={2.5} fill={GROUP_COLORS[0]} />
          <text y={11.5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK.hair}>
            {plate}
          </text>
        </g>
      )}
      {action !== 'sip' && (
        <g className="cr-mug" transform={`translate(${cx + 52} ${oy + 12})`}>
          <path d="M 12 4 q 6 0 6 5 q 0 5 -6 5" fill="none" stroke={INK.outline} strokeWidth={5} />
          <path d="M 12 4 q 6 0 6 5 q 0 5 -6 5" fill="none" stroke={ROOM.gold} strokeWidth={2.6} />
          <rect width={13} height={16} rx={2.5} fill={ROOM.gold} {...thin} />
          <ellipse cx={6.5} cy={2} rx={5} ry={1.5} fill={shade(ROOM.gold, 0.35)} />
        </g>
      )}
      <TeacherFigure
        x={cx}
        y={oy}
        figure={teacher.figure}
        action={action}
        pointAt={pointAt}
        shadowId={shadowId}
      />
    </g>
  )
}
