import { useId, type ReactElement } from 'react'
import type { AttendanceBoardData } from '../types'
import type { Layout, Rect } from '../layout'
import { GROUP_COLORS, INK, ROOM, SHADOW, TONES } from './palette'
import { MUTED, WOOD, WOOD_DARK, edge, shade, textW, thin, tint } from './kit'

// 两翼的陈设,本地坐标原点 = 区域(墙面 / 地板)左上角
// 墙面底部踢脚线高度,Wings 画墙底色时共用
export const SKIRT = 26
const WIN_W = 120, WIN_GAP = 24, WIN_Y = 22, PANE = 8
const G = GROUP_COLORS
const LEAF = GROUP_COLORS[5]
// 光斑离左墙门口留出的距离(门画在场景最左 24px 内)
const DOOR_CLEAR = 24

// eslint-disable-next-line react-refresh/only-export-components
export const windowCount = (w: number) => Math.max(0, Math.floor((w - 24) / 144))

// 一排窗在宽 w 里水平居中时每扇窗的左边 x;窗户和地面光斑共用
function windowXs(w: number, count: number): number[] {
  const x0 = (w - (count * (WIN_W + WIN_GAP) - WIN_GAP)) / 2
  return Array.from({ length: count }, (_, i) => x0 + i * (WIN_W + WIN_GAP))
}

// 树冠剪影:三团圆叠一块平底,底边落在 base 上
function Crown({ cx, base, r, fill }: { cx: number; base: number; r: number; fill: string }) {
  return (
    <g fill={fill}>
      <circle cx={cx - r * 0.55} cy={base - r * 1.1} r={r * 0.75} />
      <circle cx={cx + r * 0.5} cy={base - r} r={r * 0.7} />
      <circle cx={cx} cy={base - r * 1.5} r={r * 0.8} />
      <rect x={cx - r * 1.15} y={base - r * 1.1} width={r * 2.3} height={r * 1.1} />
    </g>
  )
}

// 正面看的一扇窗:木框 + 天色 + 窗外树冠 + 十字窗棂 + 窗台;flip 让相邻窗的树左右错开;树冠和枝条剪在玻璃里
function Window({ hgt, flip }: { hgt: number; flip: boolean }) {
  const gw = WIN_W - 2 * PANE, gb = hgt - PANE, mid = WIN_W / 2
  const glass = `cr-glass-${useId().replace(/:/g, '')}`
  const tx = PANE + (hgt - 2 * PANE) * 0.38
  const fx = (x: number) => (flip ? WIN_W - x : x)
  return (
    <g>
      <rect width={WIN_W} height={hgt} rx={4} fill={WOOD} {...edge} filter={SHADOW} />
      <rect x={PANE} y={PANE} width={gw} height={hgt - 2 * PANE} fill={ROOM.window} />
      <clipPath id={glass}><rect x={PANE} y={PANE} width={gw} height={hgt - 2 * PANE} /></clipPath>
      <g clipPath={`url(#${glass})`}>
        <Crown cx={fx(40)} base={gb} r={18} fill={tint(LEAF, 0.45)} />
        <Crown cx={fx(80)} base={gb} r={24} fill={shade(LEAF, 0.08)} />
        <path d={`M ${fx(18)} ${PANE + 22} L ${fx(30)} ${PANE + 10} M ${fx(18)} ${PANE + 34} L ${fx(40)} ${PANE + 12}`}
          stroke={INK.outline} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
      </g>
      <g strokeLinecap="butt">
        <path d={`M ${mid} ${PANE} L ${mid} ${gb} M ${PANE} ${tx} L ${WIN_W - PANE} ${tx}`} stroke={WOOD_DARK} strokeWidth={5} />
        <path d={`M ${mid} ${PANE} L ${mid} ${gb} M ${PANE} ${tx} L ${WIN_W - PANE} ${tx}`} stroke={ROOM.desk} strokeWidth={1.5} />
      </g>
      <circle cx={mid} cy={tx} r={3} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1} />
      <rect x={-6} y={hgt - 3} width={WIN_W + 12} height={8} rx={2} fill={WOOD_DARK} {...thin} filter={SHADOW} />
    </g>
  )
}

// 窗高跟着墙高走,窗台(下沿 +5)离踢脚线至少留 14
const windowHeight = (h: number) => Math.min(146, h - SKIRT - WIN_Y - 19)

// 出勤小牌占的窗位:最靠近中央(左翼窗户行最右)的那扇窗,本地坐标;一扇窗都没有就没有牌子
function boardSlot(w: number, h: number): Rect | null {
  const xs = windowXs(w, windowCount(w)), hgt = windowHeight(h)
  return xs.length && hgt > 2 * PANE ? { x: xs[xs.length - 1], y: WIN_Y, w: WIN_W, h: hgt } : null
}

// 出勤小牌在场景里的矩形(场景坐标);不加宽 / 左翼放不下一扇窗时为 null。可见性计算与测试共用
// eslint-disable-next-line react-refresh/only-export-components
export function attendanceBoardRect(layout: Layout): Rect | null {
  const wall = layout.wings?.left.wall
  const s = wall && boardSlot(wall.w, wall.h)
  return wall && s ? { x: wall.x + s.x, y: wall.y + s.y, w: s.w, h: s.h } : null
}

// 贴在墙上的出勤小牌(纸片 + 胶带):标题纸条、大号"实到"、一行请假 / 缺勤 / 迟到;只画汇总数
function AttendanceBoard({ data, h }: { data: AttendanceBoardData; h: number }) {
  const W = WIN_W
  const big = [38, 32, 26, 22].find((fs) => textW(String(data.present), fs) + textW(`/${data.total}`, 16) <= W - 20) ?? 22
  const cols = [
    { n: data.leave, tone: TONES.amber }, { n: data.absent, tone: TONES.red }, { n: data.late, tone: TONES.blue },
  ]
  const cw = (W - 16) / 3
  const numY = h - 30, labY = h - 14
  return (
    <g transform={`rotate(-1.2 ${W / 2} ${h / 2})`}>
      <rect width={W} height={h} rx={3} fill={ROOM.desk} {...thin} filter={SHADOW} />
      <rect x={8} y={14} width={W - 16} height={22} rx={2} fill={tint(G[3], 0.55)} />
      <text x={W / 2} y={30} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK.hair}>{data.title}</text>
      <text x={W / 2} y={54} textAnchor="middle" fontSize={11} fontWeight={600} letterSpacing={2} fill={MUTED}>实到</text>
      <text x={W / 2} y={54 + big * 0.95} textAnchor="middle" fontSize={big} fontWeight={800} fill={INK.hair}>
        {data.present}<tspan fontSize={16} fontWeight={600} fill={MUTED}>{`/${data.total}`}</tspan>
      </text>
      {cols.map((c, i) => (
        <g key={i}>
          <rect x={8 + i * cw + 2} y={numY - 20} width={cw - 4} height={h - numY + 26} rx={3} fill={c.tone.bg} />
          <text x={8 + (i + 0.5) * cw} y={numY} textAnchor="middle" fontSize={16} fontWeight={800} fill={c.tone.fg}>{c.n}</text>
        </g>
      ))}
      <text x={cols.map((_, i) => 8 + (i + 0.5) * cw - 11).flatMap((x) => [x, x + 11]).join(' ')} y={labY}
        fontSize={11} fontWeight={600} fill={shade(MUTED, 0.2)}>请假缺勤迟到</text>
      <g filter={SHADOW}>
        <rect x={W / 2 - 22} y={-6} width={44} height={14} rx={2} fill={tint(G[1], 0.4)} opacity={0.9} transform={`rotate(2.5 ${W / 2} 1)`} {...thin} strokeWidth={1} />
      </g>
    </g>
  )
}

export function WindowRow({ w, h, board }: { w: number; h: number; board?: AttendanceBoardData }): ReactElement {
  const hgt = windowHeight(h)
  const slot = board ? boardSlot(w, h) : null
  const xs = windowXs(w, windowCount(w))
  return (
    <g className="cr-wing-windows">
      {hgt > 2 * PANE && xs.slice(0, slot ? -1 : undefined).map((x, i) => (
        <g key={i} className="cr-wing-window" transform={`translate(${x} ${WIN_Y})`}>
          <Window hgt={hgt} flip={i % 2 === 1} />
        </g>
      ))}
      {board && slot && (
        <g data-wing-board="" transform={`translate(${slot.x} ${slot.y})`}><AttendanceBoard data={board} h={slot.h} /></g>
      )}
    </g>
  )
}

// 每扇窗在地板上投一块向左下斜的浅色光斑(同 Room 右墙窗的光斑画法),夹在地板内、避开左墙门口
// w 是两翼宽度(墙面与地板同宽),窗数和窗位都由它算,和 WindowRow 对齐
export function WindowLight({ w, h, board = false }: { w: number; h: number; board?: boolean }): ReactElement {
  const depth = Math.min(h * 0.28, 300), skew = depth * 0.3
  const cx = (x: number) => Math.min(w, Math.max(DOOR_CLEAR, x))
  return (
    <g className="cr-wing-light" fill={INK.outline} opacity={0.35}>
      {windowXs(w, windowCount(w)).slice(0, board && boardSlot(w, h) ? -1 : undefined).map((x, i) => (
        <path key={i}
          d={`M ${cx(x)} 0 L ${cx(x + WIN_W)} 0 L ${cx(x + WIN_W - skew)} ${depth} L ${cx(x - skew)} ${depth} Z`} />
      ))}
    </g>
  )
}

// 两翼标签:字样同 Zones 的区域标签
const Label = ({ x, y, children }: { x: number; y: number; children: string }) => (
  <text x={x} y={y} textAnchor="middle" fontSize={13} fontWeight={600} letterSpacing={2} fill={MUTED} opacity={0.75}>
    {children}
  </text>
)

// 手写风短线:每条略带起伏,长度按 fr 取宽度的比例
function Scribble({ x, y, w, fr, gap, c }: { x: number; y: number; w: number; fr: number[]; gap: number; c: string }) {
  const d = fr.map((f, i) => {
    const l = w * f
    return `M ${x} ${y + i * gap} q ${l / 4} ${i % 2 ? 1.2 : -1.2} ${l / 2} 0 t ${l / 2} 0`
  }).join(' ')
  return <path d={d} fill="none" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
}

// 五角星贴纸,中心在原点
const starPath = (r: number) => Array.from({ length: 10 }, (_, i) => {
  const a = (Math.PI / 5) * i - Math.PI / 2, k = i % 2 ? r * 0.45 : r
  return `${i ? 'L' : 'M'} ${(k * Math.cos(a)).toFixed(2)} ${(k * Math.sin(a)).toFixed(2)}`
}).join(' ') + ' Z'

const Sticker = ({ x, y, r, c, star }: { x: number; y: number; r: number; c: string; star: boolean }) => (
  <g transform={`translate(${x} ${y})`}>
    {star
      ? <path d={starPath(r)} fill={c} stroke={INK.outline} strokeWidth={1.2} strokeLinejoin="round" />
      : <circle r={r * 0.7} fill={c} stroke={INK.outline} strokeWidth={1.2} />}
  </g>
)

// 软木板上用图钉钉住的一张便签
function Note({ x, y, w, h, rot, paper, pin, lines }: {
  x: number; y: number; w: number; h: number; rot: number; paper: string; pin: string; lines: number[]
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})`}>
      <rect width={w} height={h} rx={1.5} fill={paper} {...thin} filter={SHADOW} />
      <Scribble x={8} y={17} w={w - 16} fr={lines} gap={9} c={paper === ROOM.desk ? ROOM.deskEdge : shade(paper, 0.22)} />
      <circle cx={w / 2} cy={5} r={3.5} fill={pin} stroke={INK.outline} strokeWidth={1} />
    </g>
  )
}

const BOARD_W = 236, BOARD_H = 142, CERT_W = 70, CERT_H = 56, CERT_GAP = 18, GROUP_GAP = 28, WALL_PAD = 24

// 班级公告:木框软木板 + 标题纸条 + 四张钉住的便签(只画短线)
function NoticeBoard({ w }: { w: number }) {
  const iw = w - 28
  const notes = [
    { x: 14, y: 28, w: iw * 0.48, h: 62, rot: -2.5, paper: ROOM.desk, pin: G[1], lines: [0.9, 0.7, 0.85, 0.5, 0.65] },
    { x: 14 + iw * 0.54, y: 26, w: iw * 0.46, h: 46, rot: 2, paper: tint(G[3], 0.55), pin: G[4], lines: [0.8, 0.6, 0.7] },
    { x: 14 + iw * 0.56, y: 80, w: iw * 0.44, h: 46, rot: -1.5, paper: tint(G[4], 0.65), pin: G[0], lines: [0.75, 0.9, 0.45] },
    { x: 18, y: 98, w: iw * 0.42, h: 28, rot: 1.5, paper: tint(G[0], 0.65), pin: G[2], lines: [0.85, 0.55] },
  ]
  return (
    <g>
      <g filter={SHADOW}>
        <rect width={w} height={BOARD_H} rx={4} fill={WOOD} {...edge} />
      </g>
      <rect x={7} y={7} width={w - 14} height={BOARD_H - 14} rx={2} fill={tint(WOOD, 0.5)} />
      <g fill={tint(WOOD, 0.25)}>
        {[[0.1, 0.4], [0.3, 0.9], [0.5, 0.55], [0.7, 0.15], [0.85, 0.7], [0.95, 0.35], [0.22, 0.2], [0.62, 0.92]].map(([fx, fy]) => (
          <circle key={`${fx}-${fy}`} cx={10 + fx * (w - 20)} cy={10 + fy * (BOARD_H - 20)} r={1.3} />
        ))}
      </g>
      {notes.map((n, i) => <Note key={i} {...n} />)}
      <g filter={SHADOW}>
        <rect x={w / 2 - 44} y={-6} width={88} height={22} rx={3} fill={G[1]} {...thin} />
      </g>
      <text x={w / 2} y={10} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK.outline}>班级公告</text>
      <Sticker x={w - 8} y={BOARD_H - 8} r={9} c={ROOM.gold} star />
    </g>
  )
}

// 一张奖状:金框 + 纸面短线 + 小印章和两条飘带
function Certificate({ c }: { c: string }) {
  return (
    <g>
      <rect width={CERT_W} height={CERT_H} rx={2} fill={ROOM.gold} {...edge} filter={SHADOW} />
      <rect x={5} y={5} width={CERT_W - 10} height={CERT_H - 10} fill={ROOM.desk} />
      <path d={`M 20 14 L ${CERT_W - 20} 14`} stroke={tint(c, 0.2)} strokeWidth={3} strokeLinecap="round" />
      <Scribble x={13} y={24} w={CERT_W - 26} fr={[1, 0.8, 0.55]} gap={7} c={ROOM.deskEdge} />
      <path d={`M ${CERT_W - 17} 43 l -3 9 l 3 -2 l 2 3 Z M ${CERT_W - 13} 43 l 3 9 l -3 -2 l -2 3 Z`} fill={shade(c, 0.15)} />
      <circle cx={CERT_W - 15} cy={41} r={6} fill={c} stroke={INK.outline} strokeWidth={1} />
    </g>
  )
}

// 荣誉墙:左边班级公告板,右边一排奖状(上挂彩旗、下贴贴纸);墙窄时先少挂奖状,一张都放不下就只留公告板
export function HonorWall({ w, h }: { w: number; h: number }): ReactElement {
  const avail = w - 2 * WALL_PAD
  const n = Math.min(5, Math.max(0, Math.floor((avail - BOARD_W - GROUP_GAP + CERT_GAP) / (CERT_W + CERT_GAP))))
  const bw = n ? BOARD_W : Math.min(BOARD_W, avail)
  const span = n * CERT_W + Math.max(0, n - 1) * CERT_GAP
  const total = bw + (n ? GROUP_GAP + span : 0)
  const x0 = (w - total) / 2, cx0 = x0 + bw + GROUP_GAP
  const flags = Math.max(3, Math.round(span / 26))
  const sag = (t: number) => 4 + 48 * t * (1 - t)
  const stickers = Array.from({ length: 2 * n + 1 }, (_, i) => i)
  return (
    <g className="cr-honor-wall">
      <g transform={`translate(${x0} ${WIN_Y})`}><NoticeBoard w={bw} /></g>
      {n > 0 && (
        <g transform={`translate(${cx0} ${WIN_Y})`}>
          <path d={`M -6 4 Q ${span / 2} 28 ${span + 6} 4`} fill="none" stroke={WOOD_DARK} strokeWidth={1.5} />
          {Array.from({ length: flags }, (_, i) => {
            const t = (i + 0.5) / flags, x = -6 + t * (span + 12), y = sag(t)
            return <path key={i} d={`M ${x - 7} ${y} L ${x + 7} ${y} L ${x} ${y + 15} Z`} fill={G[i % 6]} stroke={INK.outline} strokeWidth={1} />
          })}
          {Array.from({ length: n }, (_, i) => (
            <g key={i} transform={`translate(${i * (CERT_W + CERT_GAP)} ${i % 2 ? 42 : 38}) rotate(${[-2, 1.5, -1, 2, -1.5][i]} ${CERT_W / 2} ${CERT_H / 2})`}>
              <Certificate c={[G[1], G[4], G[0], G[2], G[5]][i]} />
            </g>
          ))}
          <g filter={SHADOW}>
            {stickers.map((i) => (
              <Sticker key={i} x={(i + 0.5) * span / stickers.length} y={118 + (i % 3) * 8} r={i % 3 === 1 ? 7 : 9}
                c={i % 2 ? G[(i + 3) % 6] : ROOM.gold} star={i % 3 !== 1} />
            ))}
          </g>
        </g>
      )}
      <Label x={x0 + total / 2} y={h - SKIRT - 8}>荣誉墙</Label>
    </g>
  )
}

const ROSTER_H = 116, DAYS = ['一', '二', '三', '四', '五']

// 值日表:木框纸面 + 手写标题 + 五列表头,格子里只有铅笔短线
function DutyRoster({ w }: { w: number }) {
  const tx = 14, tw = w - 28, cw = tw / 5, head = 36, row = 18
  const wob = (x0: number, y0: number, x1: number, y1: number, k: number) =>
    `M ${x0} ${y0} Q ${(x0 + x1) / 2 + (k % 2 ? 0.8 : -0.8)} ${(y0 + y1) / 2 + (k % 2 ? -0.8 : 0.8)} ${x1} ${y1}`
  const bottom = head + row * 4
  const grid = [
    ...Array.from({ length: 6 }, (_, i) => wob(tx + i * cw, head, tx + i * cw, bottom, i)),
    ...Array.from({ length: 5 }, (_, i) => wob(tx, head + i * row, tx + tw, head + i * row, i + 1)),
  ].join(' ')
  return (
    <g>
      <rect width={w} height={ROSTER_H} rx={4} fill={WOOD} {...edge} filter={SHADOW} />
      <rect x={6} y={6} width={w - 12} height={ROSTER_H - 12} rx={2} fill={ROOM.desk} />
      <text x={w / 2} y={26} textAnchor="middle" fontSize={13} fontWeight={700} letterSpacing={2} fill={INK.hair} opacity={0.8}>值日表</text>
      <path d={`M ${w / 2 - 26} 31 q 13 2 26 0 t 26 0`} fill="none" stroke={G[1]} strokeWidth={1.6} strokeLinecap="round" />
      {DAYS.map((d, i) => (
        <g key={d}>
          <rect x={tx + i * cw + 1} y={head + 1} width={cw - 2} height={row - 2} fill={tint([G[0], G[1], G[3], G[4], G[2]][i], 0.6)} />
          <text x={tx + (i + 0.5) * cw} y={head + 14} textAnchor="middle" fontSize={13} fontWeight={600} fill={INK.hair}>{d}</text>
        </g>
      ))}
      <path d={grid} fill="none" stroke={shade(ROOM.deskEdge, 0.2)} strokeWidth={1.3} strokeLinecap="round" />
      <path
        d={DAYS.flatMap((_, c) => [1, 2, 3].map((r) => {
          const l = cw * [0.55, 0.4, 0.62, 0.48][(c + r) % 4], x = tx + c * cw + (cw - l) / 2, y = head + r * row + row / 2 + 1
          return `M ${x} ${y} q ${l / 4} ${(c + r) % 2 ? -1.5 : 1.5} ${l / 2} 0 t ${l / 2} 0`
        })).join(' ')}
        fill="none" stroke={MUTED} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
    </g>
  )
}

// 一块挂在钩子上的抹布,顶部在原点
const Rag = ({ x, c, len }: { x: number; c: string; len: number }) => (
  <g transform={`translate(${x} 0)`}>
    <path d={`M -11 2 L 11 2 L 12 ${len - 4} Q 6 ${len + 2} 0 ${len - 3} Q -6 ${len + 2} -12 ${len - 4} Z`} fill={c} {...thin} />
    <path d={`M -10 ${len * 0.45} L 10 ${len * 0.45}`} stroke={shade(c, 0.18)} strokeWidth={2} />
  </g>
)

// 清洁角:上面挂值日表,下面一排抹布挂钩,地上水桶、扫把和簸箕;底部标签
export function CleaningCorner({ w, h }: { w: number; h: number }): ReactElement {
  const pail = G[4], pan = G[0], foot = h - 30
  return (
    <g className="cr-cleaning-corner">
      <DutyRoster w={w} />
      <g transform={`translate(0 ${ROSTER_H + 12})`}>
        <rect x={8} y={0} width={104} height={8} rx={3} fill={WOOD_DARK} {...thin} filter={SHADOW} />
        <g transform="translate(0 6)" filter={SHADOW}>
          {[[26, G[1], 30], [60, G[3], 36], [94, G[5], 28]].map(([x, c, len]) => (
            <Rag key={x as number} x={x as number} c={tint(c as string, 0.35)} len={len as number} />
          ))}
        </g>
        {[26, 60, 94].map((x) => <circle key={x} cx={x} cy={4} r={2.4} fill={ROOM.gold} stroke={INK.outline} strokeWidth={1} />)}
      </g>
      <g filter={SHADOW}>
        <g transform={`translate(54 ${foot - 46})`}>
          <path d="M -22 -2 Q 0 -30 22 -2" fill="none" stroke={shade(pail, 0.3)} strokeWidth={2.5} strokeLinecap="round" />
          <path d="M -24 0 L 24 0 L 19 46 L -19 46 Z" fill={pail} {...edge} />
          <path d="M -21.5 16 L 21.5 16" stroke={tint(pail, 0.4)} strokeWidth={4} />
          <rect x={-27} y={-5} width={54} height={9} rx={3} fill={shade(pail, 0.15)} {...thin} />
        </g>
        <g transform={`translate(${w - 62} ${foot - 118}) rotate(10)`}>
          <rect x={-3} y={0} width={6} height={80} rx={3} fill={WOOD} {...thin} />
          <rect x={-12} y={76} width={24} height={8} rx={2} fill={shade(ROOM.gold, 0.25)} {...thin} />
          <path d="M -12 84 L 12 84 Q 26 104 24 118 L -24 118 Q -26 104 -12 84 Z" fill={ROOM.gold} {...edge} />
          <path d="M -6 90 L -12 114 M 0 90 L 0 114 M 6 90 L 12 114" stroke={shade(ROOM.gold, 0.2)} strokeWidth={1.2} strokeLinecap="round" />
        </g>
        <g transform={`translate(${w - 24} ${foot - 30})`}>
          <rect x={-3} y={-22} width={6} height={24} rx={3} fill={shade(pan, 0.2)} {...thin} />
          <path d="M -16 0 L 16 0 L 18 26 Q 0 32 -18 26 Z" fill={pan} {...edge} />
          <path d="M -12 6 L 12 6" stroke={tint(pan, 0.4)} strokeWidth={2} strokeLinecap="round" />
        </g>
      </g>
      <Label x={w / 2} y={h - 8}>清洁角</Label>
    </g>
  )
}
