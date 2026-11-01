import type { Rect } from '../layout'
import type { BoardData } from '../types'
import { GROUP_COLORS, ROOM } from './palette'
import { Chalkboard, Clock, PinBoard, SmartScreen } from './wallParts'

// eslint-disable-next-line react-refresh/only-export-components
export function clockAngles(now: Date): { hour: number; minute: number } {
  const h = now.getHours(), m = now.getMinutes()
  return { hour: (h % 12) * 30 + m * 0.5, minute: m * 6 }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const CLOCK_ROOM = 52

// 按墙宽排:小展板 · 左黑板 · 智慧屏 · 右黑板 · 小展板;窄了先去小展板,再去黑板
function slots(w: number) {
  const gap = w >= 900 ? 18 : 12
  const scw = Math.max(0, Math.min(clamp((w - 24) * 0.26, 150, 240), w - 2 * CLOCK_ROOM))
  let smw = clamp((w - 24) * 0.13, 88, 128)
  let bw = Math.min(340, (w - 24 - scw - 2 * smw - 4 * gap) / 2)
  if (bw < 110) {
    smw = 0
    bw = Math.min(340, (w - 2 * CLOCK_ROOM - scw - 2 * gap) / 2)
  }
  if (bw < 90) bw = 0
  const total = scw + (bw ? 2 * (bw + gap) : 0) + (smw ? 2 * (smw + gap) : 0)
  let x = (w - total) / 2
  const at = (size: number) => {
    if (!size) return -1
    const p = x
    x += size + gap
    return p
  }
  const star = at(smw), left = at(bw), screen = at(scw), right = at(bw), bday = at(smw)
  return { gap, scw, smw, bw, star, left, screen, right, bday }
}

const mmdd = (date: string) => date.split('-').map(Number).join('/')
const BOARD_Y = 22, SCREEN_Y = 30, PIN_Y = 62

export default function FrontWall({ rect, board, now }: { rect: Rect; board?: BoardData; now: Date }) {
  const s = slots(rect.w), { hour, minute } = clockAngles(now)
  return (
    <g className="cr-front-wall" transform={`translate(${rect.x} ${rect.y})`}>
      <rect width={rect.w} height={rect.h} fill={ROOM.wall} />
      <rect y={rect.h - 26} width={rect.w} height={26} fill={ROOM.trim} />
      <path d={`M 0 ${rect.h - 26} L ${rect.w} ${rect.h - 26}`} stroke={ROOM.desk} strokeWidth={3} />
      {s.bw > 0 && (
        <>
          <g transform={`translate(${s.left} ${BOARD_Y})`}>
            <Chalkboard w={s.bw} title={board?.leftTitle} lines={board?.leftLines ?? []} />
          </g>
          <g transform={`translate(${s.right} ${BOARD_Y})`}>
            <Chalkboard w={s.bw} title={board?.rightTitle} lines={board?.rightLines ?? []} />
          </g>
        </>
      )}
      {s.scw > 0 && (
        <g transform={`translate(${s.screen} ${SCREEN_Y})`}>
          <SmartScreen w={s.scw} title={board?.screenTitle} countdown={board?.countdown} />
        </g>
      )}
      {s.smw > 0 && (
        <>
          <g transform={`translate(${s.star} ${PIN_Y})`}>
            <PinBoard w={s.smw} title="本周之星" accent={ROOM.gold}
              rows={board?.stars.map((r) => ({ name: r.name, value: `★${r.points}` })) ?? []} />
          </g>
          <g transform={`translate(${s.bday} ${PIN_Y})`}>
            <PinBoard w={s.smw} title="本月寿星" accent={GROUP_COLORS[1]}
              rows={board?.birthdays.map((r) => ({ name: r.name, value: mmdd(r.date) })) ?? []} />
          </g>
        </>
      )}
      <g transform={`translate(${rect.w - 30} 36)`}><Clock hour={hour} minute={minute} /></g>
    </g>
  )
}
