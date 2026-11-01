import { computeLayout } from '@/shared/components/ClassroomMap/layout'
import CrDefs from '@/shared/components/ClassroomMap/art/CrDefs'
import Desk, { ChairBack, ChairSeat } from '@/shared/components/ClassroomMap/art/Desk'
import FrontWall from '@/shared/components/ClassroomMap/art/FrontWall'
import Podium from '@/shared/components/ClassroomMap/art/Podium'
import Room from '@/shared/components/ClassroomMap/art/Room'
import Zones from '@/shared/components/ClassroomMap/art/Zones'
import type { BoardData, TeacherAction } from '@/shared/components/ClassroomMap/types'

const BOARD: BoardData = {
  leftTitle: '今日课程', leftLines: ['1 语文', '2 数学', '3 英语', '4 科学', '5 音乐'],
  rightTitle: '今日事项', rightLines: ['交春游回执', '值日:第三组'],
  screenTitle: '三年二班 · 11月2日 星期一',
  countdown: { label: '期末考试', days: 74 },
  stars: [{ name: '王小一', points: 5 }, { name: '李安然', points: 4 }], birthdays: [],
}

// 裸场景:房间 + 陈设区 + 前墙 + 讲台 + 每个座位一张课桌与空椅
export default function ScenePreview({ rows, cols, figure, action }: {
  rows: number; cols: number; figure: 'female' | 'male'; action: TeacherAction
}) {
  const L = computeLayout(rows, cols)
  const cells = Array.from({ length: rows * cols }, (_, i) => ({ r: Math.floor(i / cols) + 1, c: (i % cols) + 1 }))
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">场景 · {rows} 排 × {cols} 列({L.width}×{L.height})</h2>
      <svg viewBox={`0 0 ${L.width} ${L.height}`} width={L.width} height={L.height} className="cr-anim h-auto max-w-full">
        <CrDefs />
        <Room layout={L} rows={rows} />
        <Zones zones={L.zones} />
        {L.frontWall && <FrontWall rect={L.frontWall} board={BOARD} now={new Date()} />}
        {cells.map(({ r, c }) => {
          const s = L.seat(r, c)
          return (
            <g key={`${r}-${c}`}>
              <Desk x={s.x} y={s.y} seed={`e${r}-${c}`} />
              <ChairSeat x={s.x} y={s.y} />
              <ChairBack x={s.x} y={s.y} />
            </g>
          )
        })}
        {L.podium && (
          <Podium rect={L.podium} teacher={{ figure, label: '班主任' }} action={action}
            pointAt={action === 'point' ? L.head(1, cols) : undefined} />
        )}
      </svg>
    </section>
  )
}
