import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import type { StudentSeat as Seat } from '@/shared/types/student'
import Avatar from './art/Avatar'
import { groupColor } from './art/palette'
import { genderOf } from './art/StudentFigure'
import { groupOf } from '@/shared/lib/seats'
import { placeCard } from './placeCard'

const FALLBACK = { w: 200, h: 120 } // jsdom 量不出尺寸时的估计

interface Props {
  stageRef: RefObject<HTMLElement>
  seatKey: string
  children: ReactNode
}

// 舞台内的 HTML 浮层:每次渲染后按座位在舞台中的位置重新摆放(右侧优先,放不下翻左)
export default function HoverCard({ stageRef, seatKey, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current,
      stage = stageRef.current
    const seat = stage?.querySelector(`[data-seat="${seatKey}"]`)
    if (!el || !stage || !seat) return
    const s = stage.getBoundingClientRect(),
      a = seat.getBoundingClientRect()
    const p = placeCard(
      { left: a.left - s.left, top: a.top - s.top, width: a.width, height: a.height },
      { w: el.offsetWidth || FALLBACK.w, h: el.offsetHeight || FALLBACK.h },
      { w: stage.clientWidth, h: stage.clientHeight },
    )
    el.style.left = `${p.left}px`
    el.style.top = `${p.top}px`
    el.dataset.side = p.side
  })
  return (
    <div
      ref={ref}
      className="cr-hovercard absolute left-0 top-0 z-10 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md"
    >
      {children}
    </div>
  )
}

export function SeatCard({ seat, group }: { seat: Seat; group?: number }) {
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <Avatar
        gender={genderOf(seat.gender)}
        seed={seat.avatar_seed ?? seat.student_id}
        color={groupColor(group ?? groupOf(seat.seat_col ?? 1, 2, 0))}
        size={44}
        title={seat.name}
      />
      <div className="flex flex-col text-sm leading-5">
        <span className="text-base font-semibold">{seat.name}</span>
        {seat.student_no && (
          <span className="text-muted-foreground">{`学号 ${seat.student_no}`}</span>
        )}
        {seat.class_role && <span className="text-muted-foreground">{seat.class_role}</span>}
      </div>
    </div>
  )
}

export const PresentingCard = ({ seat }: { seat: Seat }) => (
  <span className="whitespace-nowrap text-2xl font-semibold">{seat.name}</span>
)
