import ClassroomMap from '@/shared/components/ClassroomMap'
import { seatsFromMiniMap } from '@/shared/components/ClassroomMap/mini'
import type { MiniSeatMap, ParentChild } from '@/shared/types/parent'

export default function MiniClassroom({ map, enrollmentId, child }: {
  map: MiniSeatMap | null; enrollmentId: string | null; child: ParentChild
}) {
  const empty = !map || map.occupied.length === 0
  const built = !empty && enrollmentId
    ? seatsFromMiniMap(map, { enrollment_id: enrollmentId, name: child.name, gender: child.gender })
    : null
  return (
    <section aria-label="班级座位" className="rounded-xl border bg-card p-4 text-card-foreground">
      <h2 className="mb-2 text-sm text-muted-foreground">班级座位</h2>
      {empty || !built ? (
        <p className="py-6 text-center text-sm text-muted-foreground">老师还没排座位</p>
      ) : (
        <div className="h-[40vh] min-h-[160px] overflow-hidden">
          <ClassroomMap
            rows={map.rows} cols={map.cols} deskSize={map.desk_size}
            podium={{ left: map.podium_left, right: map.podium_right }}
            seats={built.seats} highlight={built.highlight} mode="mini"
          />
        </div>
      )}
    </section>
  )
}
