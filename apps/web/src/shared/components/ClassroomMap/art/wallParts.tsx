import { GROUP_COLORS, INK, ROOM, SHADOW } from './palette'
import { MUTED, WOOD, WOOD_DARK, clip, edge, shade, thin, tint } from './kit'

// 前墙上的挂件,本地坐标原点 = 挂件左上角
const CHALK_DIM = tint(ROOM.board, 0.7)

export function Chalkboard({ w, title, lines }: { w: number; title?: string; lines: string[] }) {
  return (
    <g>
      <g filter={SHADOW}>
        <rect width={w} height={142} rx={4} fill={WOOD} {...edge} />
        <rect x={7} y={7} width={w - 14} height={128} rx={2} fill={ROOM.board} />
        <rect x={10} y={140} width={w - 20} height={7} rx={2} fill={WOOD_DARK} {...thin} />
      </g>
      <rect x={w - 40} y={137} width={12} height={4} rx={1.5} fill={ROOM.chalk} />
      <rect x={w - 24} y={137} width={8} height={4} rx={1.5} fill={tint(GROUP_COLORS[3], 0.3)} />
      {title && (
        <>
          <text x={18} y={30} fontSize={14} fontWeight={700} fill={ROOM.chalk}>{clip(title, w - 36, 14)}</text>
          <path d={`M 18 38 L ${Math.min(w - 18, 18 + title.length * 15)} 38`} stroke={CHALK_DIM} strokeWidth={1.5} strokeDasharray="5 4" />
        </>
      )}
      {lines.slice(0, 4).map((t, i) => (
        <text key={i} x={18} y={60 + i * 22} fontSize={13} fill={ROOM.chalk}>{clip(t, w - 36, 13)}</text>
      ))}
    </g>
  )
}

export function SmartScreen({ w, title, countdown }: {
  w: number; title?: string; countdown?: { label: string; days: number } | null
}) {
  const cx = w / 2, num = countdown ? String(countdown.days) : ''
  return (
    <g>
      <g filter={SHADOW}>
        <rect width={w} height={124} rx={6} fill={INK.hair} {...edge} />
        <rect x={6} y={6} width={w - 12} height={106} rx={3} fill={ROOM.screen} />
      </g>
      <circle cx={cx} cy={118} r={2} fill={tint(INK.hair, 0.4)} />
      {title && (
        <text x={cx} y={countdown ? 30 : 64} textAnchor="middle" fontSize={12} fontWeight={600} fill={ROOM.chalk}>
          {clip(title, w - 28, 12)}
        </text>
      )}
      {countdown && (
        <>
          <path d={`M 20 40 L ${w - 20} 40`} stroke={tint(ROOM.screen, 0.25)} strokeWidth={1} />
          <text x={cx} y={60} textAnchor="middle" fontSize={12} fill={tint(ROOM.screen, 0.7)}>{clip(`距${countdown.label}`, w - 28, 12)}</text>
          <text x={cx} y={98} textAnchor="middle" fontSize={32} fontWeight={800} fill={ROOM.gold}>{num}</text>
          <text x={cx + num.length * 10 + 6} y={97} fontSize={12} fill={tint(ROOM.screen, 0.7)}>天</text>
        </>
      )}
    </g>
  )
}

export function PinBoard({ w, title, accent, rows }: {
  w: number; title: string; accent: string; rows?: { name: string; value: string }[]
}) {
  return (
    <g>
      <g filter={SHADOW}>
        <rect width={w} height={108} rx={4} fill={tint(WOOD, 0.62)} {...edge} />
        <rect x={8} y={-4} width={w - 16} height={20} rx={3} fill={accent} {...thin} />
      </g>
      <circle cx={14} cy={6} r={3} fill={shade(accent, 0.3)} />
      <circle cx={w - 14} cy={6} r={3} fill={shade(accent, 0.3)} />
      <text x={w / 2} y={11} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK.outline}>{title}</text>
      {rows && rows.length === 0 && <text x={w / 2} y={60} textAnchor="middle" fontSize={12} fill={MUTED}>暂无</text>}
      {rows?.slice(0, 3).map((r, i) => (
        <g key={i} transform={`translate(0 ${36 + i * 24})`}>
          <rect x={6} y={-13} width={w - 12} height={19} rx={3} fill={ROOM.desk} opacity={0.85} />
          <text x={11} y={1} fontSize={12} fill={INK.hair}>{clip(r.name, w - 52, 12)}</text>
          <text x={w - 11} y={1} textAnchor="end" fontSize={11} fontWeight={700} fill={shade(accent, 0.25)}>{r.value}</text>
        </g>
      ))}
    </g>
  )
}

export function Clock({ hour, minute }: { hour: number; minute: number }) {
  return (
    <g className="cr-clock">
      <circle r={19} fill={GROUP_COLORS[4]} {...edge} filter={SHADOW} />
      <circle r={15} fill={ROOM.desk} />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d={i % 3 ? 'M 0 -13 L 0 -11.5' : 'M 0 -13 L 0 -10'} transform={`rotate(${i * 30})`}
          stroke={INK.hair} strokeWidth={i % 3 ? 1 : 1.6} strokeLinecap="round" />
      ))}
      <path d="M 0 1.5 L 0 -7.5" transform={`rotate(${hour})`} stroke={INK.hair} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M 0 2 L 0 -11.5" transform={`rotate(${minute})`} stroke={INK.hair} strokeWidth={1.7} strokeLinecap="round" />
      <circle r={1.8} fill={GROUP_COLORS[1]} />
    </g>
  )
}
