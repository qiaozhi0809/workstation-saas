import ClassroomMap from '@/shared/components/ClassroomMap'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import type { ClassAdmin } from '@/shared/types/admin'

export default function DeskSummary({ cls }: { cls: ClassAdmin }) {
  return (
    <Card>
      <CardHeader><CardTitle>桌椅排列</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <ul className="grid content-start gap-1 text-sm">
          <li>{`${cls.seat_rows} 排 × ${cls.seat_cols} 个座位 + 讲台边 ${cls.podium_left + cls.podium_right} 个`}</li>
          <li>{`每桌 ${cls.desk_size} 人`}</li>
          <li>{`排列方式:${cls.seat_layout === 'auto' ? '按学号自动排' : '手动排'}`}</li>
        </ul>
        <div className="h-48 min-w-0 overflow-hidden rounded-md border">
          <ClassroomMap mode="mini" rows={cls.seat_rows} cols={cls.seat_cols} deskSize={cls.desk_size}
            podium={{ left: cls.podium_left, right: cls.podium_right }} seats={[]} />
        </div>
      </CardContent>
    </Card>
  )
}
