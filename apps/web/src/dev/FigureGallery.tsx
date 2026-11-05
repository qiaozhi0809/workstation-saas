import Avatar from '@/shared/components/ClassroomMap/art/Avatar'
import CrDefs from '@/shared/components/ClassroomMap/art/CrDefs'
import { groupColor, ROOM } from '@/shared/components/ClassroomMap/art/palette'
import StudentFigure, {
  hairStyleOf,
  type HairStyle,
  type Pose,
} from '@/shared/components/ClassroomMap/art/StudentFigure'
import TeacherFigure from '@/shared/components/ClassroomMap/art/TeacherFigure'
import type { TeacherAction } from '@/shared/components/ClassroomMap/types'

type G = 'female' | 'male' | null
const POSES: Pose[] = ['sit', 'turn', 'look', 'raise', 'doze', 'stretch', 'stand']
const STYLES: [G, HairStyle][] = [
  ['female', 'braid'],
  ['female', 'bob'],
  ['female', 'pony'],
  ['male', 'spiky'],
  ['male', 'buzz'],
  ['male', 'side'],
  [null, 'beanie'],
]
const ACTIONS: TeacherAction[] = ['idle', 'sip', 'point']
const seedFor = (g: G, style: HairStyle) => {
  for (let i = 0; i < 500; i++) if (hairStyleOf(g, `g${i}`) === style) return `g${i}`
  return 'g0'
}
const CW = 110,
  CH = 150,
  LW = 70

export default function FigureGallery() {
  const w = LW + POSES.length * CW,
    h = 30 + STYLES.length * CH
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">角色画廊</h2>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        className="cr-anim max-w-full"
        style={{ background: ROOM.floor }}
      >
        <CrDefs />
        {POSES.map((p, i) => (
          <text
            key={p}
            x={LW + i * CW + CW / 2}
            y={18}
            textAnchor="middle"
            fontSize={13}
            fill="#555"
          >
            {p}
          </text>
        ))}
        {STYLES.map(([g, style], r) => (
          <g key={style}>
            <text x={8} y={30 + r * CH + 70} fontSize={13} fill="#555">
              {style}
            </text>
            {POSES.map((p, i) => (
              <g key={p}>
                <rect
                  x={LW + i * CW + 13}
                  y={30 + r * CH + 22}
                  width={84}
                  height={40}
                  rx={4}
                  fill={ROOM.desk}
                  stroke={ROOM.deskEdge}
                />
                <StudentFigure
                  x={LW + i * CW + CW / 2}
                  y={30 + r * CH + 70}
                  gender={g}
                  seed={seedFor(g, style)}
                  color={groupColor(r)}
                  pose={p}
                />
              </g>
            ))}
          </g>
        ))}
      </svg>
      <svg
        viewBox="0 0 780 190"
        width={780}
        height={190}
        className="cr-anim mt-4 max-w-full"
        style={{ background: ROOM.floor }}
      >
        <CrDefs />
        {(['female', 'male'] as const).map((f, r) =>
          ACTIONS.map((a, i) => {
            const x = 70 + (r * 3 + i) * 125,
              y = 120
            return (
              <g key={f + a}>
                <rect
                  x={x - 50}
                  y={y}
                  width={100}
                  height={36}
                  rx={4}
                  fill={ROOM.desk}
                  stroke={ROOM.deskEdge}
                />
                <TeacherFigure
                  x={x}
                  y={y}
                  figure={f}
                  action={a}
                  pointAt={{ x: x + (r ? -1 : 1) * 60, y: y + 160 }}
                />
                <text x={x} y={y + 54} textAnchor="middle" fontSize={12} fill="#555">
                  {f} · {a}
                </text>
              </g>
            )
          }),
        )}
      </svg>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {STYLES.map(([g, style], i) => (
          <Avatar
            key={style}
            gender={g}
            seed={seedFor(g, style)}
            color={groupColor(i)}
            size={i === 0 ? 72 : 48}
            title={style}
          />
        ))}
      </div>
    </section>
  )
}
