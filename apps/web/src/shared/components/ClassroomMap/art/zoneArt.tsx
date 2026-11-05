import type { ReactElement } from 'react'
import type { ZoneId } from '../layout'
import { seededRandom } from './hash'
import { GROUP_COLORS, INK, ROOM, SHADOW } from './palette'
import { MUTED, WOOD, WOOD_DARK, edge, shade, thin, tint } from './kit'

// 各陈设区的画法,本地坐标:原点 = 区域左上角,宽 w;内容只占 [0, h - 24],底部留给标签
type Art = (p: { w: number; h: number }) => ReactElement
const G = GROUP_COLORS
const GREEN = G[5],
  LEAF = shade(G[5], 0.15)

function Reading({ w }: { w: number }) {
  const rnd = seededRandom('reading'),
    sx = (w - 188) / 2
  const shelf = [0, 1].map((r) =>
    Array.from({ length: 10 }, (_, i) => ({
      x: 9 + i * 17.2,
      h: 26 + Math.floor(rnd() * 8),
      c: G[Math.floor(rnd() * 6)],
      r,
    })),
  )
  return (
    <>
      <g filter={SHADOW}>
        <rect x={sx} y={6} width={188} height={92} rx={4} fill={WOOD} {...edge} />
        {[0, 1].map((r) => (
          <rect
            key={r}
            x={sx + 6}
            y={12 + r * 42}
            width={176}
            height={36}
            fill={tint(WOOD, 0.45)}
          />
        ))}
      </g>
      {shelf.flat().map((b) => (
        <rect
          key={`${b.r}-${b.x}`}
          x={sx + b.x}
          y={48 + b.r * 42 - b.h}
          width={13}
          height={b.h}
          rx={1.5}
          fill={b.c}
          stroke={INK.outline}
          strokeWidth={1}
        />
      ))}
      <ellipse cx={w / 2} cy={174} rx={w / 2 - 14} ry={50} fill={tint(G[2], 0.72)} {...edge} />
      <ellipse
        cx={w / 2}
        cy={174}
        rx={w / 2 - 34}
        ry={34}
        fill="none"
        stroke={tint(G[2], 0.45)}
        strokeWidth={3}
        strokeDasharray="6 6"
      />
      <g filter={SHADOW}>
        {[
          [w / 2 - 46, 166, G[1]],
          [w / 2 + 42, 182, G[0]],
        ].map(([x, y, c]) => (
          <g key={c as string} transform={`translate(${x} ${y})`}>
            <path
              d="M -30 10 Q -34 -18 -8 -26 Q 18 -32 30 -8 Q 36 14 10 22 Q -24 28 -30 10 Z"
              fill={c as string}
              {...edge}
            />
            <path
              d="M -14 -6 Q 0 -14 14 -4"
              fill="none"
              stroke={tint(c as string, 0.4)}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
    </>
  )
}

const Frame = ({ x, c }: { x: number; c: string }) => (
  <g transform={`translate(${x} 14)`}>
    <rect width={58} height={44} rx={2} fill={ROOM.gold} {...edge} />
    <rect x={5} y={5} width={48} height={34} fill={ROOM.desk} />
    <path
      d="M 12 13 L 46 13 M 15 20 L 43 20 M 15 26 L 36 26"
      stroke={ROOM.deskEdge}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <circle cx={43} cy={31} r={5} fill={c} stroke={INK.outline} strokeWidth={1} />
  </g>
)

function Honor({ w }: { w: number }) {
  const gap = (w - 3 * 58) / 4,
    cx = w / 2
  return (
    <>
      <g filter={SHADOW}>
        {[0, 1, 2].map((i) => (
          <Frame key={i} x={gap + i * (58 + gap)} c={[G[1], G[4], G[0]][i]} />
        ))}
      </g>
      <g filter={SHADOW} transform={`translate(${cx} 0)`}>
        <rect x={-46} y={118} width={92} height={30} rx={3} fill={WOOD} {...edge} />
        <rect x={-14} y={104} width={28} height={14} rx={2} fill={WOOD_DARK} {...thin} />
        <path d="M -20 72 L 20 72 Q 20 98 0 100 Q -20 98 -20 72 Z" fill={ROOM.gold} {...edge} />
        <path
          d="M -20 78 Q -32 78 -28 88 Q -25 94 -16 93 M 20 78 Q 32 78 28 88 Q 25 94 16 93"
          fill="none"
          stroke={ROOM.gold}
          strokeWidth={3}
        />
        <rect x={-4} y={99} width={8} height={6} fill={shade(ROOM.gold, 0.12)} />
        <path
          d="M 0 78 L 2.4 83 L 7.5 83.5 L 3.6 87 L 4.7 92 L 0 89.4 L -4.7 92 L -3.6 87 L -7.5 83.5 L -2.4 83 Z"
          fill={INK.outline}
        />
      </g>
    </>
  )
}

const Bin = ({ x, c, mark }: { x: number; c: string; mark: string }) => (
  <g transform={`translate(${x} 34)`}>
    <path d="M 2 10 L 44 10 L 40 76 L 6 76 Z" fill={c} {...edge} />
    <rect x={-1} y={2} width={48} height={11} rx={4} fill={shade(c, 0.15)} {...edge} />
    <rect x={16} y={-2} width={14} height={6} rx={2} fill={shade(c, 0.15)} {...thin} />
    <text x={23} y={50} textAnchor="middle" fontSize={10} fontWeight={700} fill={INK.outline}>
      {mark}
    </text>
  </g>
)

function Cleaning({ w }: { w: number }) {
  return (
    <g filter={SHADOW}>
      <Bin x={w / 2 - 92} c={G[4]} mark="可回收" />
      <Bin x={w / 2 - 38} c={shade(ROOM.trim, 0.25)} mark="其他" />
      <g transform={`translate(${w / 2 + 52} 18) rotate(14)`}>
        <rect x={-3} y={0} width={6} height={74} rx={3} fill={WOOD} {...thin} />
        <path d="M -16 74 L 16 74 L 20 102 L -20 102 Z" fill={ROOM.gold} {...edge} />
        <path
          d="M -10 80 L -12 100 M 0 80 L 0 100 M 10 80 L 12 100"
          stroke={shade(ROOM.gold, 0.2)}
          strokeWidth={1.2}
        />
      </g>
    </g>
  )
}

function Homework({ w }: { w: number }) {
  const cw = 46,
    sx = (w - 4 * cw - 12) / 2
  return (
    <>
      <g filter={SHADOW}>
        <rect x={sx} y={10} width={4 * cw + 12} height={112} rx={4} fill={WOOD} {...edge} />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={sx + 6 + i * cw + 2}
            y={18}
            width={cw - 4}
            height={96}
            rx={2}
            fill={tint(WOOD, 0.5)}
          />
        ))}
      </g>
      {[0, 1, 2, 3].map((i) => {
        const x = sx + 6 + i * cw + 6,
          c = G[[0, 1, 2, 4][i]]
        return (
          <g key={i}>
            {Array.from({ length: 5 + ((i * 2) % 3) }, (_, k) => (
              <rect
                key={k}
                x={x + (k % 2) * 1.5}
                y={104 - k * 7}
                width={cw - 13}
                height={7}
                rx={1}
                fill={k % 2 ? tint(c, 0.5) : c}
                stroke={INK.outline}
                strokeWidth={1}
              />
            ))}
            <text
              x={x + (cw - 12) / 2}
              y={142}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill={MUTED}
            >
              {'语数英科'[i]}
            </text>
          </g>
        )
      })}
    </>
  )
}

const Plant = ({ x, y, s, c }: { x: number; y: number; s: number; c: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse
      cx={-10}
      cy={-20}
      rx={9}
      ry={15}
      transform="rotate(-28 -10 -20)"
      fill={GREEN}
      {...thin}
    />
    <ellipse cx={10} cy={-22} rx={9} ry={16} transform="rotate(26 10 -22)" fill={LEAF} {...thin} />
    <ellipse cx={0} cy={-30} rx={8} ry={17} fill={GREEN} {...thin} />
    <path d="M -15 -6 L 15 -6 L 11 18 L -11 18 Z" fill={c} {...edge} />
    <rect x={-17} y={-9} width={34} height={7} rx={2} fill={shade(c, 0.12)} {...thin} />
  </g>
)

function Nature({ w }: { w: number }) {
  const tw = Math.min(200, w - 24),
    tx = (w - tw) / 2
  return (
    <>
      <g filter={SHADOW}>
        <rect x={tx - 6} y={82} width={tw + 12} height={12} rx={3} fill={WOOD} {...edge} />
        <rect x={tx} y={10} width={tw} height={72} rx={4} fill={ROOM.window} {...edge} />
      </g>
      <rect x={tx + 3} y={22} width={tw - 6} height={57} fill={tint(G[4], 0.55)} />
      <path
        d={`M ${tx + 3} 79 Q ${tx + 30} 68 ${tx + 60} 76 Q ${tx + tw / 2} 70 ${tx + tw - 40} 77 L ${tx + tw - 3} 79 Z`}
        fill={ROOM.deskEdge}
      />
      {[
        [tx + 50, 40, G[1]],
        [tx + tw - 60, 54, ROOM.gold],
        [tx + tw / 2, 62, G[1]],
      ].map(([x, y, c]) => (
        <g key={`${x}`} transform={`translate(${x} ${y})`}>
          <path
            d="M -10 0 Q 0 -8 10 0 Q 0 8 -10 0 Z M 9 0 L 16 -5 L 16 5 Z"
            fill={c as string}
            stroke={INK.outline}
            strokeWidth={1}
          />
          <circle cx={-4} cy={-1} r={1.2} fill={INK.hair} />
        </g>
      ))}
      <path
        d={`M ${tx + 22} 74 Q ${tx + 16} 56 ${tx + 24} 40 M ${tx + tw - 22} 76 Q ${tx + tw - 28} 60 ${tx + tw - 20} 48`}
        fill="none"
        stroke={GREEN}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <g filter={SHADOW}>
        {[0, 1, 2].map((i) => (
          <Plant
            key={i}
            x={w / 2 + (i - 1) * 66}
            y={144}
            s={i === 1 ? 1.05 : 0.9}
            c={[G[1], ROOM.gold, G[2]][i]}
          />
        ))}
      </g>
    </>
  )
}

function Sports({ w }: { w: number }) {
  const bx = w / 2 - 104
  return (
    <>
      <g filter={SHADOW}>
        {[
          [bx + 30, 38, G[1]],
          [bx + 64, 32, INK.outline],
          [bx + 96, 40, G[4]],
        ].map(([x, y, c]) => (
          <circle
            key={`${x}`}
            cx={x as number}
            cy={y as number}
            r={18}
            fill={c as string}
            stroke={c === INK.outline ? ROOM.trim : INK.outline}
            strokeWidth={2}
          />
        ))}
        <rect x={bx + 4} y={46} width={120} height={62} rx={5} fill={tint(G[3], 0.2)} {...edge} />
      </g>
      <path
        d={`M ${bx + 14} 104 L ${bx + 14} 54 M ${bx + 114} 104 L ${bx + 114} 54 ${[34, 54, 74, 94].map((x) => `M ${bx + x} 50 L ${bx + x} 104`).join(' ')} M ${bx + 8} 76 L ${bx + 120} 76`}
        stroke={shade(G[3], 0.12)}
        strokeWidth={1.4}
      />
      <g filter={SHADOW} transform={`translate(${bx + 172} 64)`}>
        <path
          d="M -24 30 C -48 4 -18 -36 4 -20 C 26 -4 -10 18 6 34 C 20 46 40 22 26 0"
          fill="none"
          stroke={INK.outline}
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d="M -24 30 C -48 4 -18 -36 4 -20 C 26 -4 -10 18 6 34 C 20 46 40 22 26 0"
          fill="none"
          stroke={G[2]}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <rect
          x={-30}
          y={28}
          width={10}
          height={18}
          rx={4}
          transform="rotate(-30 -25 37)"
          fill={G[1]}
          {...thin}
        />
        <rect
          x={22}
          y={-14}
          width={10}
          height={18}
          rx={4}
          transform="rotate(20 27 -5)"
          fill={G[1]}
          {...thin}
        />
      </g>
    </>
  )
}

const Armchair = ({ x, flip, c }: { x: number; flip: boolean; c: string }) => (
  <g transform={`translate(${x} 92) scale(${flip ? -1 : 1} 1)`}>
    <rect x={-26} y={-30} width={50} height={60} rx={12} fill={shade(c, 0.12)} {...edge} />
    <rect x={-14} y={-22} width={34} height={44} rx={8} fill={c} {...thin} />
    <rect x={-22} y={-34} width={44} height={11} rx={5} fill={shade(c, 0.12)} {...thin} />
    <rect x={-22} y={23} width={44} height={11} rx={5} fill={shade(c, 0.12)} {...thin} />
  </g>
)

function Talk({ w }: { w: number }) {
  return (
    <>
      <ellipse cx={w / 2} cy={92} rx={w / 2 - 10} ry={66} fill={tint(G[3], 0.7)} {...edge} />
      <g filter={SHADOW}>
        <Armchair x={w / 2 - 70} flip={false} c={G[0]} />
        <Armchair x={w / 2 + 70} flip c={G[1]} />
        <circle cx={w / 2} cy={92} r={26} fill={WOOD} {...edge} />
      </g>
      <circle cx={w / 2 - 7} cy={88} r={6} fill={ROOM.desk} {...thin} />
      <path d={`M ${w / 2 + 4} 96 l 0 -9 q 3 -6 6 0 l 0 9 Z`} fill={G[2]} {...thin} />
      <circle cx={w / 2 + 7} cy={83} r={4} fill={GREEN} />
    </>
  )
}

const ART: Record<ZoneId, Art> = {
  reading: Reading,
  honor: Honor,
  cleaning: Cleaning,
  homework: Homework,
  nature: Nature,
  sports: Sports,
  talk: Talk,
}

export default function ZoneArt({ id, w, h }: { id: ZoneId; w: number; h: number }) {
  const Art = ART[id]
  return <Art w={w} h={h} />
}
