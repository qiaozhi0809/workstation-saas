import ClassroomMap from '@/shared/components/ClassroomMap'
import { seatsFromMiniMap } from '@/shared/components/ClassroomMap/mini'
import { Card } from '@/shared/components/ui/card'
import type { MiniSeatMap, ParentChild } from '@/shared/types/parent'

export default function MiniClassroom({
  map,
  enrollmentId,
  child,
}: {
  map: MiniSeatMap | null
  enrollmentId: string | null
  child: ParentChild
}) {
  const occupied = map?.occupied ?? []
  // 孩子自己没有座位时整张图不画:别人的座位匿名,没有高亮的图没有意义
  const empty = !map || !map.mine || occupied.length === 0
  const built =
    !empty && enrollmentId
      ? seatsFromMiniMap(
          { ...map, occupied },
          { enrollment_id: enrollmentId, name: child.name, gender: child.gender },
        )
      : null
  return (
    <Card role="region" aria-label="班级座位" className="p-4">
      <h2 className="mb-2 text-sm text-muted-foreground">班级座位</h2>
      {empty || !built ? (
        <p className="py-6 text-center text-sm text-muted-foreground">老师还没排座位</p>
      ) : (
        <div
          data-testid="seat-frame"
          className="aspect-[4/3] max-h-[50vh] w-full overflow-hidden rounded-md dark:bg-card dark:p-2"
        >
          <ClassroomMap
            rows={map.rows}
            cols={map.cols}
            deskSize={map.desk_size}
            podium={{ left: map.podium_left, right: map.podium_right }}
            seats={built.seats}
            highlight={built.highlight}
            mode="mini"
          />
        </div>
      )}
    </Card>
  )
}
